import * as vscode from 'vscode';
import { getConnections } from './connections';
import { bracket, ObjectRef } from './objectRef';
import { clientFor } from './sqlServerClient';

interface TableIndexData {
    entries: ObjectRef[];
    builtAt: number;
}

const STORAGE_KEY = 'fabric-sql-table-index';

/** Local index of every table/view across all connections, for the explorer's search mode. */
export class TableIndexService {

    constructor(private readonly globalState: vscode.Memento) { }

    public getIndex(): ObjectRef[] {
        return this.globalState.get<TableIndexData>(STORAGE_KEY)?.entries || [];
    }

    public getBuiltAt(): number | null {
        return this.globalState.get<TableIndexData>(STORAGE_KEY)?.builtAt || null;
    }

    public search(term: string): ObjectRef[] {
        const q = term.toLowerCase();
        return this.getIndex().filter(e => (e.name || '').toLowerCase().includes(q));
    }

    public async buildIndex(): Promise<number> {
        return vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Building table index...', cancellable: true },
            async (progress, token) => {
                const entries: ObjectRef[] = [];
                const conns = getConnections();

                for (let i = 0; i < conns.length; i++) {
                    if (token.isCancellationRequested) { break; }
                    const conn = conns[i];
                    progress.report({ message: `Scanning ${conn.id} (${i + 1}/${conns.length})...`, increment: 100 / conns.length });
                    try {
                        const client = clientFor(conn);
                        const dbs = (await client.query(`SELECT name FROM sys.databases WHERE state = 0`)).map(r => String(r[0]));
                        for (const database of dbs) {
                            if (token.isCancellationRequested) { break; }
                            try {
                                const rows = await client.query(
                                    `SELECT s.name, o.name, RTRIM(o.type) FROM ${bracket(database)}.sys.objects o ` +
                                    `JOIN ${bracket(database)}.sys.schemas s ON s.schema_id = o.schema_id WHERE o.type IN ('U','V')`);
                                for (const r of rows) {
                                    entries.push({ conn: conn.id, database, schema: String(r[0]), name: String(r[1]), kind: String(r[2]) === 'V' ? 'view' : 'table' });
                                }
                            } catch { /* database not accessible — skip */ }
                        }
                    } catch { /* connection failed — skip */ }
                }

                await this.globalState.update(STORAGE_KEY, { entries, builtAt: Date.now() } as TableIndexData);
                return entries.length;
            }
        );
    }

    public async clearIndex(): Promise<void> {
        await this.globalState.update(STORAGE_KEY, undefined);
    }
}
