import { FsqlDocumentItem } from "../language/fsqlDocument";
import { splitChain, textAt } from "../language/tsqlParser";
import { TableSchemaColumn } from "./tableSchemaColumn";
import { getActiveConnection } from "./connections";
import { bracket } from "./objectRef";
import { clientFor } from "./sqlServerClient";
import { connectionForDatabase } from "./queryRouter";

/**
 * Column cache for hover / completion, filled from INFORMATION_SCHEMA.COLUMNS over the active
 * connection. Field names keep the Fabric SQL-era shape (project_id = database, dataset_name =
 * schema) so the providers that render them need no change; renamed in M9.
 */
export class TableSchemaService {

    private schemas: TableSchemaColumn[] = [];
    private loading = new Set<string>();

    public clearCache(): void {
        this.schemas = [];
        this.loading.clear();
    }

    public getCachedTableCount(): number {
        return new Set(this.schemas.map(s => this.key(s.project_id, s.dataset_name, s.table_name))).size;
    }

    public async preLoadSchemaToCache(sql: string, tableIdentifier: FsqlDocumentItem): Promise<boolean> {
        const table = this.resolveTableIdentifier(sql, tableIdentifier);
        if (!table) { return false; }
        const [database, schema, name] = table;
        const key = this.key(database, schema, name);
        if (this.loading.has(key) || this.schemas.some(s => this.key(s.project_id, s.dataset_name, s.table_name) === key)) { return false; }

        // The database may live on another connection (Fabric: another workspace) — route like queries do.
        const conn = await connectionForDatabase(database);
        if (!conn) { return false; }

        this.loading.add(key);
        try {
            const rows = await clientFor(conn).query(
                `SELECT COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION FROM ${bracket(database)}.INFORMATION_SCHEMA.COLUMNS ` +
                `WHERE TABLE_SCHEMA = N'${lit(schema)}' AND TABLE_NAME = N'${lit(name)}' ORDER BY ORDINAL_POSITION`);
            const fresh: TableSchemaColumn[] = rows.map(r => ({
                project_id: database, dataset_name: schema, table_name: name,
                column_name: String(r[0]), data_type: String(r[1]), ordinal_position: String(r[2]),
                is_partitioning_column: 'NO', description: '',
            }));
            this.schemas = this.schemas.filter(s => this.key(s.project_id, s.dataset_name, s.table_name) !== key);
            this.schemas.push(...fresh);
            return fresh.length > 0;
        } finally {
            this.loading.delete(key);
        }
    }

    public getSchemaFromCache(sql: string, tableIdentifier: FsqlDocumentItem): TableSchemaColumn[] {
        const table = this.resolveTableIdentifier(sql, tableIdentifier);
        if (!table) { return []; }
        const key = this.key(...table);
        return this.schemas.filter(s => this.key(s.project_id, s.dataset_name, s.table_name) === key);
    }

    /** `t` → [active db, dbo, t]; `s.t` → [active db, s, t]; `d.s.t` (or `srv.d.s.t`) → last three. */
    private resolveTableIdentifier(sql: string, tableIdentifier: FsqlDocumentItem): [string, string, string] | null {
        if (tableIdentifier.item_type !== 'TableIdentifier') { return null; }
        const chain = tableIdentifier.items.find(c => c.item_type.startsWith('TableIdentifier') && c.item_type !== 'TableIdentifierAlias');
        if (!chain) { return null; }

        const parts = splitChain(textAt(sql, chain.range)).filter((p, i, arr) => p !== '' || i === arr.length - 2);
        if (parts.length === 0) { return null; }
        const name = parts[parts.length - 1];
        if (!name || /^[@#]/.test(name)) { return null; }

        const conn = getActiveConnection();
        const database = parts.length >= 3 ? parts[parts.length - 3] : (conn?.database ?? '');
        const schema = parts.length >= 2 && parts[parts.length - 2] ? parts[parts.length - 2] : 'dbo';
        if (!database) { return null; }
        return [database, schema, name];
    }

    /** Columns of a table already in the cache, without querying; empty when it is not cached. */
    public getCachedColumns(database: string, schema: string, name: string): Array<{ name: string; type: string }> {
        const key = this.key(database, schema, name);
        return this.schemas
            .filter(s => this.key(s.project_id, s.dataset_name, s.table_name) === key)
            .sort((a, b) => Number(a.ordinal_position) - Number(b.ordinal_position))
            .map(s => ({ name: s.column_name, type: s.data_type }));
    }

    private key(database: string, schema: string, name: string): string {
        return `${database}.${schema}.${name}`.toLowerCase();
    }
}

function lit(s: string): string {
    return s.replace(/'/g, "''");
}
