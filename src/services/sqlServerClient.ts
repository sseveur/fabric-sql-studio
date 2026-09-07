import * as sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import { getAccessToken, SCOPE_TDS } from './auth';
import { SqlColumn, SqlResultSet } from '../tableResultsPanel/resultContract';
import { ConnectionRef } from './objectRef';

/**
 * TDS client over `mssql`/tedious with an Entra access token. Serves SQL Server, Azure SQL and
 * Fabric Warehouse / Lakehouse SQL endpoints identically.
 *
 * Results are materialised host-side (TDS has no page token) up to `maxRows`, then the grid
 * pages over the in-memory copy. ponytail: in-memory buffer capped at maxRows; spill to disk or
 * re-run with OFFSET/FETCH only if users actually hit the cap.
 */
export interface QueryResult {
    id: string;
    sets: SqlResultSet[];
    elapsedMs: number;
}

export type SqlConnectionTarget = Pick<ConnectionRef, 'server' | 'database' | 'port'>;

const results = new Map<string, QueryResult>();
const MAX_KEPT_RESULTS = 20;

export function getResultPage(resultId: string, setIndex: number, startIndex: number, pageSize: number): unknown[][] {
    const set = results.get(resultId)?.sets[setIndex];
    if (!set) { throw new Error('Result set is no longer available; re-run the query.'); }
    return set.rows.slice(startIndex, startIndex + pageSize);
}

export class SqlServerClient {

    private pool: sql.ConnectionPool | null = null;
    private poolToken: string | null = null;
    private dbList: Promise<string[]> | null = null;

    constructor(public readonly target: SqlConnectionTarget) { }

    private async getPool(): Promise<sql.ConnectionPool> {
        const tokenInfo = await getAccessToken(SCOPE_TDS, true);
        if (!tokenInfo) { throw new Error('Not signed in. Use the Authentication view to sign in first.'); }

        // Token rotated → the pool's connections carry the old one; rebuild.
        if (this.pool && this.poolToken === tokenInfo.token) { return this.pool; }
        await this.dispose();

        const config: sql.config = {
            server: this.target.server,
            port: this.target.port ?? 1433,
            database: this.target.database,
            authentication: { type: 'azure-active-directory-access-token', options: { token: tokenInfo.token } },
            options: { encrypt: true, trustServerCertificate: false },
            requestTimeout: 10 * 60 * 1000,
            pool: { max: 4, min: 0 },
        };
        this.pool = await new sql.ConnectionPool(config).connect();
        this.poolToken = tokenInfo.token;
        return this.pool;
    }

    public async runQuery(text: string, maxRows: number): Promise<QueryResult> {
        const pool = await this.getPool();
        const started = Date.now();
        const sets: SqlResultSet[] = [];
        let current: SqlResultSet | null = null;

        await new Promise<void>((resolve, reject) => {
            const request = new sql.Request(pool);
            request.stream = true;
            request.arrayRowMode = true;
            let failed: Error | null = null;

            request.on('recordset', (columns: sql.IColumnMetadata) => {
                current = { index: sets.length, columns: toColumns(columns), rows: [], totalRows: 0, truncated: false };
                sets.push(current);
            });
            request.on('row', (row: unknown[]) => {
                if (!current) { return; }
                current.totalRows++;
                if (current.rows.length < maxRows) {
                    current.rows.push(row.map(jsonSafe));
                } else if (!current.truncated) {
                    current.truncated = true;
                    request.cancel();
                }
            });
            request.on('rowsaffected', (n: number) => {
                // A rowset statement also emits rowsaffected (= its row count); only a statement
                // with no recordset of its own is a DML/DDL result worth its own entry.
                if (current) { current = null; return; }
                sets.push({ index: sets.length, columns: [], rows: [], totalRows: 0, truncated: false, rowsAffected: n });
            });
            request.on('error', (err: Error) => { failed = failed ?? err; });
            request.on('done', () => {
                // cancel() after hitting maxRows surfaces as an error we deliberately caused.
                const truncatedOnly = failed && sets.some(s => s.truncated) && /cancel/i.test(failed.message);
                if (failed && !truncatedOnly) { reject(failed); } else { resolve(); }
            });
            request.batch(text);
        });

        const result: QueryResult = { id: uuidv4(), sets, elapsedMs: Date.now() - started };
        results.set(result.id, result);
        if (results.size > MAX_KEPT_RESULTS) {
            const oldest = results.keys().next().value;
            if (oldest) { results.delete(oldest); }
        }
        return result;
    }

    /** Small metadata query: all rows, positional, no cap. */
    public async query(text: string): Promise<unknown[][]> {
        const pool = await this.getPool();
        const request = new sql.Request(pool);
        request.arrayRowMode = true;
        const res = await request.query(text);
        return ((res.recordset ?? []) as unknown as unknown[][]).map(row => row.map(jsonSafe));
    }

    /** Databases visible on this endpoint (on Fabric: every warehouse / lakehouse in the workspace). Cached per client. */
    public databases(): Promise<string[]> {
        if (!this.dbList) {
            this.dbList = this.query(`SELECT name FROM sys.databases WHERE state = 0 ORDER BY name`)
                .then(rows => rows.map(r => String(r[0])))
                .catch(err => { this.dbList = null; throw err; });
        }
        return this.dbList;
    }

    public async dispose(): Promise<void> {
        const p = this.pool;
        this.pool = null;
        this.poolToken = null;
        this.dbList = null;
        if (p) { try { await p.close(); } catch { /* ignore */ } }
    }
}

function toColumns(meta: sql.IColumnMetadata): SqlColumn[] {
    return Object.values(meta)
        .sort((a, b) => a.index - b.index)
        .map(c => ({ name: c.name, type: declarationOf(c.type), nullable: c.nullable }));
}

function declarationOf(t: unknown): string {
    // mssql TYPES are factory functions carrying `.declaration` ('nvarchar'); instances wrap them in `.type`.
    const anyT = t as { declaration?: string; type?: { declaration?: string }; name?: string } | undefined;
    return (anyT?.declaration ?? anyT?.type?.declaration ?? anyT?.name ?? 'unknown').toLowerCase();
}

/** postMessage/JSON-friendly cell values. */
function jsonSafe(v: unknown): unknown {
    if (v instanceof Date) { return isNaN(v.getTime()) ? null : v.toISOString(); }
    if (Buffer.isBuffer(v)) { return '0x' + v.toString('hex'); }
    if (typeof v === 'bigint') { return v.toString(); }
    return v;
}

// One client per connection profile; pools are rebuilt inside the client when the token rotates.
const clients = new Map<string, SqlServerClient>();

export function clientFor(conn: ConnectionRef): SqlServerClient {
    const key = `${conn.server}|${conn.database}|${conn.port ?? 1433}`;
    let c = clients.get(key);
    if (!c) { c = new SqlServerClient(conn); clients.set(key, c); }
    return c;
}

export async function disposeAllClients(): Promise<void> {
    const all = [...clients.values()];
    clients.clear();
    await Promise.all(all.map(c => c.dispose()));
}
