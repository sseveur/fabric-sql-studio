import * as vscode from 'vscode';
import * as commands from '../extensionCommands';
import { BigqueryIcons } from '../bigqueryIcons';
import { ObjectRef } from '../services/objectRef';

/** Grouping nodes that are not database objects themselves. */
export type TreeNodeKind = ObjectRef['kind'] | 'pinnedFolder' | 'routinesFolder';

export class ObjectTreeItem extends vscode.TreeItem {

    constructor(
        public readonly nodeKind: TreeNodeKind,
        public readonly ref: ObjectRef,
        label: string,
        description: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        opts: { pinned?: boolean; active?: boolean; pinnedEntry?: boolean } = {}
    ) {
        super(label, collapsibleState);
        this.description = description;

        const icons = new BigqueryIcons();
        switch (nodeKind) {
            case 'connection':
                this.iconPath = new vscode.ThemeIcon(opts.active ? 'plug' : 'debug-disconnect');
                this.contextValue = 'sql-connection';
                break;
            case 'database':
                this.iconPath = new vscode.ThemeIcon('database');
                this.contextValue = 'sql-database';
                break;
            case 'schema':
                this.iconPath = icons.dataset;
                this.contextValue = 'sql-schema';
                break;
            case 'table':
            case 'view':
                this.iconPath = nodeKind === 'view' ? icons.tableView : icons.table;
                this.contextValue = opts.pinnedEntry ? 'sql-pinned-table' : opts.pinned ? 'sql-table-already-pinned' : 'sql-table';
                this.command = { command: commands.COMMAND_VIEW_TABLE, title: 'Preview', arguments: [this] };
                break;
            case 'routine':
                this.iconPath = icons.routine;
                this.contextValue = 'sql-routine';
                break;
            case 'routinesFolder':
                this.iconPath = new vscode.ThemeIcon('symbol-method');
                this.contextValue = 'sql-routines-folder';
                break;
            case 'pinnedFolder':
                this.iconPath = new vscode.ThemeIcon('pinned');
                this.contextValue = 'sql-pinned-folder';
                break;
        }
    }
}
