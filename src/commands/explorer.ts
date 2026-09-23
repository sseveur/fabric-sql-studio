import * as vscode from 'vscode';
import { clientFor } from '../services/sqlServerClient';
import { sqlTreeDataProvider, tableSchemaService } from '../extension';
import { getConnection, getConnections, pinObject, setActiveConnection, unpinObject, SETTING_CONNECTIONS } from '../services/connections';
import { listSqlItems, listWorkspaces } from '../services/fabricClient';
import { ObjectRef, displayName, qualifiedName } from '../services/objectRef';
import { QueryGeneratorService } from '../services/queryGeneratorService';
import { TableIndexService } from '../services/tableIndexService';
import { COMMAND_BUILD_TABLE_INDEX, COMMAND_EXPLORER_REFRESH } from './ids';
import { warnNoConnection } from './query';

export const commandExplorerRefresh = function (...args: any[]) {

	const t1 = Date.now();

	sqlTreeDataProvider.refresh();

};

export const commandCreateTableDefaultQuery = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }

	const doc = await vscode.workspace.openTextDocument({
		language: 'fsql',
		content: QueryGeneratorService.generateSelectQuery(ref)
	});
	await vscode.commands.executeCommand<vscode.TextDocumentShowOptions>("vscode.open", doc.uri);
};

/** Views, procedures and functions carry a definition; tables have no stored DDL in T-SQL. */
export const commandOpenDdl = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }
	const conn = getConnection(ref.conn);
	if (!conn) { return warnNoConnection(); }

	try {
		const rows = await clientFor(conn).query(QueryGeneratorService.generateDefinitionQuery(ref));
		const definition = rows[0]?.[0];
		if (typeof definition !== 'string' || !definition.trim()) {
			vscode.window.showInformationMessage(`${displayName(ref)} has no stored definition (tables don't; use Preview Schema).`);
			return;
		}
		const doc = await vscode.workspace.openTextDocument({ language: 'fsql', content: definition });
		await vscode.commands.executeCommand<vscode.TextDocumentShowOptions>("vscode.open", doc.uri);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Open definition failed: ${error?.message ?? error}`);
	}
};

export const commandUseConnection = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.conn) { return; }
	await setActiveConnection(ref.conn);
	vscode.commands.executeCommand(COMMAND_EXPLORER_REFRESH);
};

export const commandOpenSettingConnections = async function () {
	vscode.commands.executeCommand('workbench.action.openSettings', SETTING_CONNECTIONS);
};

export const commandAddFabricConnection = async function () {
	try {
		const workspaces = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Listing Fabric workspaces…' },
			() => listWorkspaces());
		if (workspaces.length === 0) { vscode.window.showInformationMessage('No Fabric workspaces visible to this account.'); return; }

		const ws = await vscode.window.showQuickPick(
			workspaces.map(w => ({ label: w.displayName, description: w.type === 'Personal' ? 'My workspace' : '', workspace: w })),
			{ title: 'Add Fabric connection (1/2): workspace', placeHolder: 'Workspace', matchOnDescription: true });
		if (!ws) { return; }

		const items = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Listing SQL items in ${ws.label}…` },
			() => listSqlItems(ws.workspace.id));
		if (items.length === 0) { vscode.window.showInformationMessage(`No warehouses, lakehouses or SQL databases in ${ws.label}.`); return; }

		const picked = await vscode.window.showQuickPick(
			items.map(i => ({
				label: `$(${i.type === 'Warehouse' ? 'database' : i.type === 'Lakehouse' ? 'archive' : 'server'}) ${i.displayName}`,
				description: i.type,
				detail: i.unavailableReason ? `Unavailable: ${i.unavailableReason}` : i.server,
				item: i,
			})),
			{ title: 'Add Fabric connection (2/2): warehouse / lakehouse / SQL database', placeHolder: 'Item', matchOnDescription: true });
		if (!picked) { return; }
		if (picked.item.unavailableReason) { vscode.window.showWarningMessage(`${picked.item.displayName}: ${picked.item.unavailableReason}`); return; }

		const existing = getConnections();
		let id = `${ws.label}/${picked.item.displayName}`;
		if (existing.some(c => c.id === id)) { id = `${id} (${existing.length + 1})`; }

		const raw = vscode.workspace.getConfiguration().get<any[]>(SETTING_CONNECTIONS, []) || [];
		await vscode.workspace.getConfiguration().update(SETTING_CONNECTIONS,
			[...raw, { id, server: picked.item.server, database: picked.item.database, kind: 'fabric' }], vscode.ConfigurationTarget.Global);
		await setActiveConnection(id);
		vscode.commands.executeCommand(COMMAND_EXPLORER_REFRESH);
		vscode.window.showInformationMessage(`Connection "${id}" added and made active.`);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Add Fabric connection failed: ${error?.message ?? error}`);
	}
};

// Table Index
let tableIndexService: TableIndexService | null = null;

export function initTableIndexService(globalState: vscode.Memento): TableIndexService {
	if (!tableIndexService) {
		tableIndexService = new TableIndexService(globalState);
	}
	return tableIndexService;
}

export function getTableIndexService(): TableIndexService | null {
	return tableIndexService;
}

// Refresh Schema Cache
export const commandRefreshSchemaCache = function (...args: any[]) {
	const cachedCount = tableSchemaService.getCachedTableCount();
	tableSchemaService.clearCache();

	if (cachedCount > 0) {
		vscode.window.showInformationMessage(`Fabric SQL: Schema cache cleared (${cachedCount} table${cachedCount === 1 ? '' : 's'} removed)`);
	} else {
		vscode.window.showInformationMessage('Fabric SQL: Schema cache was already empty');
	}
};

// Pin / unpin object
export const commandPinTable = async function (...args: any[]) {
	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }
	await pinObject(ref);
	vscode.commands.executeCommand(COMMAND_EXPLORER_REFRESH);
};

export const commandUnpinTable = async function (...args: any[]) {
	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }
	await unpinObject(ref);
	vscode.commands.executeCommand(COMMAND_EXPLORER_REFRESH);
};

// Search Tables (uses local index from globalState)
export const commandSearchTables = async function (...args: any[]) {

	const tableIndexService = getTableIndexService();
	if (!tableIndexService) { return; }

	const index = tableIndexService.getIndex();
	if (index.length === 0) {
		const action = await vscode.window.showWarningMessage(
			'No table index found. Build the index first to enable search.',
			'Build Index'
		);
		if (action === 'Build Index') {
			vscode.commands.executeCommand(COMMAND_BUILD_TABLE_INDEX);
		}
		return;
	}

	const term = await vscode.window.showInputBox({
		prompt: `Search ${index.length} indexed tables`,
		placeHolder: 'Table name...'
	});

	if (term === undefined) {
		return;
	}

	if (term === '') {
		sqlTreeDataProvider.setSearchTerm(null);
		return;
	}

	sqlTreeDataProvider.setSearchTerm(term);
};

// Clear Search
export const commandClearSearch = function (...args: any[]) {
	sqlTreeDataProvider.setSearchTerm(null);
};

// Build Table Index
export const commandBuildTableIndex = async function (...args: any[]) {

	const tableIndexService = getTableIndexService();
	if (!tableIndexService) { return; }

	const count = await tableIndexService.buildIndex();
	vscode.window.showInformationMessage(`Table index built: ${count} tables indexed`);
};

// Copy object path — bracket-quoted by default so it pastes straight into a FROM clause.
export const commandCopyTablePath = async function (...args: any[]) {
	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }

	const quoted = vscode.workspace.getConfiguration('fabricSql').get<boolean>('copyTablePathBackticks', true);
	const tablePath = quoted ? qualifiedName(ref) : displayName(ref);
	await vscode.env.clipboard.writeText(tablePath);
	vscode.window.showInformationMessage(`Copied: ${tablePath}`);
};
