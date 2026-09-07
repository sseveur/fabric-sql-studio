import * as vscode from 'vscode';
import { ObjectTreeItem } from './objectTreeItem';
import { getActiveConnection, getConnections, getPinnedObjectKeys, isPinned } from '../services/connections';
import { bracket, ConnectionRef, ObjectRef, parseKey } from '../services/objectRef';
import { clientFor } from '../services/sqlServerClient';
import { getTableIndexService } from '../extensionCommands';

/**
 * Explorer: connections → databases → schemas → tables / views (+ a Routines folder).
 * Metadata comes from the catalog views over the same TDS connection queries use, so the
 * tree shows exactly what the signed-in user can see. Fabric lists every warehouse and
 * lakehouse in the workspace under `sys.databases`.
 */
export class SqlTreeDataProvider implements vscode.TreeDataProvider<ObjectTreeItem> {

    private searchTerm: string | null = null;
    private routines = new Map<string, ObjectTreeItem[]>();

    private _onDidChangeTreeData = new vscode.EventEmitter<void | ObjectTreeItem | ObjectTreeItem[] | null | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: ObjectTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ObjectTreeItem): Promise<ObjectTreeItem[]> {
        if (!element) {
            if (this.searchTerm) { return this.searchObjects(this.searchTerm); }
            const pinned = this.getPinnedItems();
            const roots = this.getConnectionItems();
            if (pinned.length === 0) { return roots; }
            const folder = new ObjectTreeItem('pinnedFolder', { conn: '', kind: 'connection' }, 'Pinned', '', vscode.TreeItemCollapsibleState.Collapsed);
            return [folder, ...roots];
        }

        const ref = element.ref;
        switch (element.nodeKind) {
            case 'pinnedFolder': return this.getPinnedItems();
            case 'connection': return this.getDatabases(ref);
            case 'database': return this.getSchemas(ref);
            case 'schema': return this.getObjects(ref);
            case 'routinesFolder': return this.routines.get(`${ref.conn}/${ref.database}/${ref.schema}`) ?? [];
            default: return [];
        }
    }

    private getConnectionItems(): ObjectTreeItem[] {
        const active = getActiveConnection();
        return getConnections().map(c => new ObjectTreeItem(
            'connection',
            { conn: c.id, kind: 'connection' },
            c.id,
            c.id === active?.id ? 'ACTIVE' : (c.database || c.server),
            vscode.TreeItemCollapsibleState.Collapsed,
            { active: c.id === active?.id }
        ));
    }

    private async getDatabases(ref: ObjectRef): Promise<ObjectTreeItem[]> {
        const conn = getConnections().find(c => c.id === ref.conn);
        if (!conn) { throw new Error(`Unknown connection "${ref.conn}"`); }
        const names = await clientFor(conn).databases();
        return names.map(name => new ObjectTreeItem('database', { conn: ref.conn, database: name, kind: 'database' }, name, '', vscode.TreeItemCollapsibleState.Collapsed));
    }

    private async getSchemas(ref: ObjectRef): Promise<ObjectTreeItem[]> {
        const db = bracket(ref.database!);
        const rows = await this.query(ref.conn, `SELECT name FROM ${db}.sys.schemas WHERE name NOT IN ('sys','INFORMATION_SCHEMA','guest','queryinsights') AND name NOT LIKE 'db[_]%' ORDER BY name`);
        return rows.map(r => new ObjectTreeItem('schema', { ...ref, schema: String(r[0]), kind: 'schema' }, String(r[0]), '', vscode.TreeItemCollapsibleState.Collapsed));
    }

    private async getObjects(ref: ObjectRef): Promise<ObjectTreeItem[]> {
        const db = bracket(ref.database!);
        const rows = await this.query(ref.conn,
            `SELECT o.name, RTRIM(o.type) FROM ${db}.sys.objects o JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id ` +
            `WHERE s.name = N'${sqlLiteral(ref.schema!)}' AND o.type IN ('U','V','P','FN','IF','TF') ORDER BY o.name`);

        const items: ObjectTreeItem[] = [];
        const routines: ObjectTreeItem[] = [];
        for (const r of rows) {
            const name = String(r[0]);
            const type = String(r[1]);
            if (type === 'U' || type === 'V') {
                const objRef: ObjectRef = { ...ref, name, kind: type === 'V' ? 'view' : 'table' };
                items.push(new ObjectTreeItem(objRef.kind, objRef, name, '', vscode.TreeItemCollapsibleState.None, { pinned: isPinned(objRef) }));
            } else {
                const objRef: ObjectRef = { ...ref, name, kind: 'routine' };
                routines.push(new ObjectTreeItem('routine', objRef, name, type === 'P' ? 'procedure' : 'function', vscode.TreeItemCollapsibleState.None));
            }
        }
        if (routines.length) {
            this.routines.set(`${ref.conn}/${ref.database}/${ref.schema}`, routines);
            items.unshift(new ObjectTreeItem('routinesFolder', ref, `Routines (${routines.length})`, '', vscode.TreeItemCollapsibleState.Collapsed));
        }
        return items;
    }

    private getPinnedItems(): ObjectTreeItem[] {
        return getPinnedObjectKeys()
            .map(k => parseKey(k))
            .filter((r): r is ObjectRef => !!r && !!r.name)
            .map(r => new ObjectTreeItem('table', r, r.name!, `${r.conn} · ${r.database}.${r.schema}`, vscode.TreeItemCollapsibleState.None, { pinnedEntry: true }));
    }

    private searchObjects(term: string): ObjectTreeItem[] {
        const index = getTableIndexService();
        if (!index) { return []; }
        return index.search(term).map(r => new ObjectTreeItem(r.kind === 'view' ? 'view' : 'table', r, r.name!, `${r.conn} · ${r.database}.${r.schema}`, vscode.TreeItemCollapsibleState.None, { pinned: isPinned(r) }));
    }

    private async query(connId: string, sql: string): Promise<unknown[][]> {
        const conn: ConnectionRef | undefined = getConnections().find(c => c.id === connId);
        if (!conn) { throw new Error(`Unknown connection "${connId}"`); }
        return clientFor(conn).query(sql);
    }

    setSearchTerm(term: string | null): void {
        this.searchTerm = term;
        vscode.commands.executeCommand('setContext', 'bigquery.isSearching', term !== null);
        this._onDidChangeTreeData.fire();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

function sqlLiteral(s: string): string {
    return s.replace(/'/g, "''");
}
