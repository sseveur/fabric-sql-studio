import * as vscode from 'vscode';
import { BigQueryClient } from './services/bigqueryClient';
import { clientFor, disposeAllClients } from './services/sqlServerClient';
import { SqlResultMessage } from './tableResultsPanel/resultContract';
import { sqlTreeDataProvider, QUERY_RESULTS_VIEW_TYPE, TABLE_RESULTS_VIEW_TYPE, authenticationWebviewProvider, bigqueryTableSchemaService } from './extension';
import { Authentication } from './services/authentication';
import { describeToken, getAccessToken, SCOPE_FABRIC, SCOPE_TDS, signIn, signOut } from './services/auth';
import { getActiveConnection, getConnection, getConnections, pinObject, setActiveConnection, unpinObject, SETTING_CONNECTIONS } from './services/connections';
import { listSqlItems, listWorkspaces } from './services/fabricClient';
import { ConnectionRef, ObjectRef, displayName, qualifiedName, refToKey } from './services/objectRef';
import { SchemaRender } from './tableResultsPanel/schemaRender';
import { QueryGeneratorService } from './services/queryGeneratorService';
import { ResultsGridRender } from './tableResultsPanel/resultsGridRender';
import { v4 as uuidv4 } from 'uuid';
import { DownloadCsv } from './tableResultsPanel/downloadCsv';
import { QueryResultsMappingService } from './services/queryResultsMappingService';
import { QueryResultsMapping } from './services/queryResultsMapping';
// import { JobReference } from "./services/queryResultsMapping";
// import { TableReference } from './services/tableMetadata';
import { ResultsRender } from './services/resultsRender';
import { QueryResultsVisualizationType } from './services/queryResultsVisualizationType';
import { DownloadJsonl } from './tableResultsPanel/downloadJsonl';
import { CopyToClipboard } from './tableResultsPanel/copyToClipboard';
// import { Job } from '@google-cloud/bigquery';
import { ResultsGridRenderRequestV2, ResultsGridRenderRequestV2Type } from './tableResultsPanel/resultsGridRenderRequestV2';
import { Dataset, Table } from '@google-cloud/bigquery';
import { formatBigQuerySQL } from './language/bqsqlFormatter';
import { buildJobDetails } from './services/jobHistoryService';
import { renderJobDetailsHtml } from './activitybar/jobDetailsPanel';
import { textToNotebookData } from './notebook/bqSqlNotebookSerializer';
import { QueryHistoryItem, QueryHistoryService } from './services/queryHistoryService';
import { TableIndexService } from './services/tableIndexService';
import { buildMultiQueryLineage } from './services/lineageGraph';
import { showMultiLineagePanel } from './lineage/lineageWebviewProvider';
import { runColumnProfileForTable } from './services/columnProfile';
import { showColumnProfilePanel } from './tableResultsPanel/columnProfilePanel';
import { resolveColumnAtPosition, ResolvedColumn, resolveTableAtPosition } from './services/columnResolver';

export const COMMAND_CLEAR_EXTENSION_CACHE = "vscode-bigquery.clear-extension-cache";
export const COMMAND_RUN_QUERY = "vscode-bigquery.run-query";
export const COMMAND_RUN_SELECTED_QUERY = "vscode-bigquery.run-selected-query";
export const COMMAND_PREVIEW_CTE = "vscode-bigquery.preview-cte";
export const COMMAND_PROFILE_COLUMN = "vscode-bigquery.profile-column";
export const COMMAND_PREVIEW_TABLE_AT_CURSOR = "vscode-bigquery.preview-table-at-cursor";
export const COMMAND_USER_LOGIN = "vscode-bigquery.user-login";
export const COMMAND_AUTH_TOKEN_INFO = "vscode-bigquery.auth-token-info";
export const COMMAND_AUTHENTICATION_REFRESH = "vscode-bigquery.authentication-refresh";
export const COMMAND_EXPLORER_REFRESH = "vscode-bigquery.explorer-refresh";
export const COMMAND_VIEW_TABLE = "vscode-bigquery.view-table";
export const COMMAND_VIEW_TABLE_SCHEMA = "vscode-bigquery.view-table-schema";
export const COMMAND_CREATE_TABLE_DEFAULT_QUERY = "vscode-bigquery.create-table-default-query";
export const COMMAND_OPEN_DDL = "vscode-bigquery.open-ddl";
export const COMMAND_SET_DEFAULT_PROJECT = "vscode-bigquery.set-default-project";
export const COMMAND_DOWNLOAD_CSV = "vscode-bigquery.download-csv";
export const COMMAND_DOWNLOAD_JSONL = "vscode-bigquery.download-jsonl";
export const COMMAND_COPY_CLIPBOARD = "vscode-bigquery.copy-to-clipboard";
export const OPEN_SETTING_CONNECTIONS = "vscode-bigquery.open-settings-connections";
export const COMMAND_ADD_FABRIC_CONNECTION = "vscode-bigquery.add-fabric-connection";
export const COMMAND_FORMAT_QUERY = "vscode-bigquery.format-query";
export const COMMAND_HISTORY_RERUN = "vscode-bigquery.history-rerun";
export const COMMAND_HISTORY_COPY = "vscode-bigquery.history-copy";
export const COMMAND_HISTORY_CLEAR = "vscode-bigquery.history-clear";
export const COMMAND_HISTORY_SHOW = "vscode-bigquery.history-show";
export const COMMAND_HISTORY_DELETE = "vscode-bigquery.history-delete";
export const COMMAND_JOB_HISTORY_SHOW = "vscode-bigquery.job-history-show";
export const COMMAND_JOB_HISTORY_OPEN_RESULTS = "vscode-bigquery.job-history-open-results";
export const COMMAND_JOB_HISTORY_REFRESH = "vscode-bigquery.job-history-refresh";
export const COMMAND_JOB_HISTORY_TOGGLE_ALL_USERS = "vscode-bigquery.job-history-toggle-all-users";
export const COMMAND_JOB_HISTORY_LOAD_MORE = "vscode-bigquery.job-history-load-more";
export const COMMAND_JOB_HISTORY_DETAILS = "vscode-bigquery.job-history-details";
export const COMMAND_HISTORY_REFRESH = "vscode-bigquery.history-refresh";
export const COMMAND_SHOW_LINEAGE = "vscode-bigquery.show-lineage";
export const COMMAND_SHOW_LINEAGE_SELECTION = "vscode-bigquery.show-lineage-selection";
export const COMMAND_REFRESH_SCHEMA_CACHE = "vscode-bigquery.refresh-schema-cache";
export const COMMAND_SET_LINEAGE_EXPORT_THEME = "vscode-bigquery.set-lineage-export-theme";
export const COMMAND_REVOKE_SESSION = "vscode-bigquery.revoke-session";
export const COMMAND_PIN_TABLE = "vscode-bigquery.pin-table";
export const COMMAND_UNPIN_TABLE = "vscode-bigquery.unpin-table";
export const COMMAND_SEARCH_TABLES = "vscode-bigquery.search-tables";
export const COMMAND_CLEAR_SEARCH = "vscode-bigquery.clear-search";
export const COMMAND_COPY_TABLE_PATH = "vscode-bigquery.copy-table-path";
export const COMMAND_BUILD_TABLE_INDEX = "vscode-bigquery.build-table-index";
export const COMMAND_OPEN_AS_NOTEBOOK = "vscode-bigquery.open-as-notebook";
export const COMMAND_OPEN_AS_TEXT = "vscode-bigquery.open-as-text";

/**
 * Check if SQL is a CREATE TABLE statement
 */
function isCreateTableStatement(sql: string): boolean {
	// Regex: CREATE [OR REPLACE] [TEMP|TEMPORARY] TABLE [IF NOT EXISTS]
	return /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.test(sql.trim());
}

/**
 * Extract the created table name from CREATE TABLE statement
 */
function extractCreatedTableName(sql: string): string | null {
	// Match table name after CREATE TABLE keywords
	const match = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`\w.\-]+)/i);
	return match ? match[1] : null;
}

export const commandRunQuery = async function (this: any, ...args: any[]) {

	return commandQuery(this, RunQueryType.query);

};

export const commandRunSelectedQuery = async function (this: any, ...args: any[]) {

	return commandQuery(this, RunQueryType.selectedQuery);

};

/**
 * Runs a single CTE in isolation and shows its rows in the results grid.
 * Invoked by the CTE-preview CodeLens, which passes the already-rewritten
 * query (WITH upstream CTEs … SELECT * FROM <cte> LIMIT n) and the CTE name.
 */
export const commandPreviewCte = async function (this: any, ...args: any[]) {

	const previewSql: string = args[0];
	const cteName: string = args[1] ?? 'cte';
	if (!previewSql) { return; }

	const globalState: vscode.Memento = this.globalState;
	const queryResultsWebviewMapping: Map<string, ResultsRender> = this.queryResultsWebviewMapping;

	const textEditor = vscode.window.activeTextEditor;

	let uuid: string | undefined;
	if (textEditor) {
		uuid = QueryResultsMappingService.getQueryResultsMappingUuid(globalState, textEditor, QueryResultsVisualizationType.table);
		if (!uuid) { uuid = uuidv4().substring(0, 8); }
		QueryResultsMappingService.upsertQueryResultsMapping(globalState, uuid, textEditor, QueryResultsVisualizationType.table);
	} else {
		uuid = uuidv4().substring(0, 8);
	}

	await runQuery(globalState, queryResultsWebviewMapping, uuid, `CTE: ${cteName}`, previewSql);

};

/**
 * Profiles the column at the cursor. The SQL surrounding the cursor is parsed to
 * find which table the identifier belongs to (via FROM/JOIN clauses and any
 * `alias.column` qualifier), the column type is read from the schema cache, and
 * type-aware aggregates (COUNT, DISTINCT, NULL%, MIN/MAX, APPROX_QUANTILES, top-K)
 * are run directly against the source table. The result is rendered with charts
 * in a side panel.
 */
export const commandProfileColumn = async function (this: any, ...args: any[]) {

	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor) {
		vscode.window.showWarningMessage('Open a SQL file and place the cursor on a column name to profile it.');
		return;
	}

	const document = textEditor.document;
	const sql = document.getText();
	const offset = document.offsetAt(textEditor.selection.active);

	const bqClient = await getBigQueryClient();
	const defaultProjectId = await bqClient.getProjectId();

	let resolved: ResolvedColumn | null = null;
	try {
		resolved = await resolveColumnAtPosition(bqClient, sql, offset, defaultProjectId);
	} catch (err) {
		vscode.window.showErrorMessage(`Profile column: ${(err as Error).message || err}`);
		return;
	}

	if (!resolved) {
		vscode.window.showWarningMessage('Place the cursor on a column name (or `alias.column`) before running Profile Column.');
		return;
	}

	const target = resolved;
	const subtitle = `${target.projectId}.${target.datasetId}.${target.tableId}.${target.columnName} · ${target.columnType}`;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Profiling \`${target.columnName}\`…`, cancellable: false },
		async () => {
			try {
				const profile = await runColumnProfileForTable(
					bqClient,
					{ projectId: target.projectId, datasetId: target.datasetId, tableId: target.tableId },
					target.columnName,
					target.columnType
				);
				showColumnProfilePanel(profile, subtitle);
			} catch (err) {
				vscode.window.showErrorMessage(`Profile failed: ${(err as Error).message || err}`);
			}
		}
	);

};

/**
 * Right-click → "BigQuery: Preview Table". Resolves the table reference under the
 * cursor (fully-qualified path, dataset.table, bare name, or FROM/JOIN alias) and
 * opens the standard table preview grid — same rendering the explorer tree uses.
 */
export const commandPreviewTableAtCursor = async function (...args: any[]) {

	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor) {
		vscode.window.showWarningMessage('Open a SQL file and place the cursor on a table name to preview it.');
		return;
	}

	const conn = getActiveConnection();
	if (!conn) { return warnNoConnection(); }

	const document = textEditor.document;
	const sql = document.getText();
	const offset = document.offsetAt(textEditor.selection.active);

	let resolved = null;
	try {
		resolved = await resolveTableAtPosition(sql, offset, conn.database);
	} catch (err) {
		vscode.window.showErrorMessage(`Preview table: ${(err as Error).message || err}`);
		return;
	}

	if (!resolved) {
		vscode.window.showWarningMessage('Place the cursor on a table name (or its alias) before running Preview Table.');
		return;
	}

	// The resolver still speaks project.dataset.table; for T-SQL that is database.schema.name.
	const ref: ObjectRef = { conn: conn.id, database: resolved.projectId || conn.database, schema: resolved.datasetId, name: resolved.tableId, kind: 'table' };
	await commandViewTable({ ref });
};

enum RunQueryType {
	query = 1,
	selectedQuery = 2
}

const commandQuery = async function (local: any, queryType: RunQueryType) {

	const t1 = Date.now();

	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

	if (activeTab === undefined) {
		return;
	}

	const textEditor = vscode.window.activeTextEditor;
	if (textEditor === undefined) {
		return;
	}

	const queryText: string = (queryType === RunQueryType.query) ? textEditor.document.getText() ?? '' : textEditor.document.getText(textEditor.selection) ?? '';

	const globalState: vscode.Memento = local.globalState;
	const queryResultsWebviewMapping: Map<string, ResultsRender> = local.queryResultsWebviewMapping;

	let uuid = QueryResultsMappingService.getQueryResultsMappingUuid(globalState, textEditor, QueryResultsVisualizationType.table);
	if (!uuid) {
		uuid = uuidv4().substring(0, 8);
	}

	QueryResultsMappingService.upsertQueryResultsMapping(globalState, uuid, textEditor, QueryResultsVisualizationType.table);

	const numberOfJobs = await runQuery(globalState, queryResultsWebviewMapping, uuid, activeTab.label, queryText);


};

const runQuery = async function (globalState: vscode.Memento, queryResultsWebviewMapping: Map<string, ResultsRender>, uuid: string, mainLabel: string, queryText: string): Promise<number> {

	const queryStartTime = Date.now();

	let performLock = false;
	if (vscode.window.tabGroups.all.filter(c => c.viewColumn === vscode.ViewColumn.Two).length === 0) {
		await vscode.commands.executeCommand('workbench.action.editorLayoutTwoRows');
		performLock = true;
	}

	const label = `Visualization: ${mainLabel} | ${uuid}`;

	let resultsGridRender = QueryResultsMappingService.getQueryResultsMappingResultsGridRender(queryResultsWebviewMapping, uuid);

	if (resultsGridRender) {

		resultsGridRender.reveal(undefined, true);

	} else {

		const panel = vscode.window.createWebviewPanel(QUERY_RESULTS_VIEW_TYPE, label, { viewColumn: vscode.ViewColumn.Two, preserveFocus: true }, { enableFindWidget: true, enableScripts: true, retainContextWhenHidden: true });
		resultsGridRender = new ResultsGridRender(panel);

		//lock the tab group in vscode.ViewColumn.Two
		if (performLock) {
			panel.reveal(undefined, false);
			await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
			await vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
		}

		await resultsGridRender.render1();

		QueryResultsMappingService.updateQueryResultsMappingWebviewPanel(queryResultsWebviewMapping, uuid, resultsGridRender);

		//action when panel is closed
		panel.onDidDispose(e => {
			QueryResultsMappingService.deleteQueryResultsMapping(globalState, uuid);
		});
	}

	const conn = getActiveConnection();
	if (!conn) {
		warnNoConnection();
		return 0;
	}
	return runSqlQuery(resultsGridRender, conn, queryText, queryStartTime);
};

export const commandUserLogin = async function (...args: any[]) {

	resetBigQueryClient();

	try {
		const account = await signIn();
		if (account) {
			vscode.window.showInformationMessage(`Signed in as ${account}`);
		} else {
			vscode.window.showWarningMessage('Sign-in was cancelled or no account is available.');
		}
	} catch (error: any) {
		vscode.window.showErrorMessage(`Sign-in failed: ${error?.message ?? error}`);
	}

	vscode.commands.executeCommand(COMMAND_AUTHENTICATION_REFRESH);

};

let authOutput: vscode.OutputChannel | null = null;

/** Diagnostics: audience / tenant / expiry for both token scopes. Never prints the token. */
export const commandAuthTokenInfo = async function (...args: any[]) {

	if (!authOutput) { authOutput = vscode.window.createOutputChannel('BigQuery Studio: Auth'); }
	const out = authOutput;
	out.clear();
	out.show(true);

	for (const [name, scope] of [['SQL (TDS)', SCOPE_TDS], ['Fabric REST', SCOPE_FABRIC]] as const) {
		out.appendLine(`== ${name} — ${scope}`);
		try {
			const info = await getAccessToken(scope, true);
			if (!info) { out.appendLine('   no session'); continue; }
			for (const [k, v] of Object.entries(describeToken(info))) { out.appendLine(`   ${k}: ${v}`); }
		} catch (error: any) {
			out.appendLine(`   ERROR: ${error?.message ?? error}`);
		}
	}

};

export const commandAuthenticationRefresh = function (...args: any[]) {

	resetBigQueryClient();

	authenticationWebviewProvider.refresh();

};

export const commandExplorerRefresh = function (...args: any[]) {

	const t1 = Date.now();

	sqlTreeDataProvider.refresh();

};

export const commandViewTable = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }
	const conn = getConnection(ref.conn);
	if (!conn) { return warnNoConnection(); }

	await openSqlPanel(refToKey(ref), args[1], conn, QueryGeneratorService.generatePreviewQuery(ref));
};

export const commandViewTableSchema = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }
	const conn = getConnection(ref.conn);
	if (!conn) { return warnNoConnection(); }

	await openSqlPanel(`Schema: ${displayName(ref)}`, undefined, conn, QueryGeneratorService.generateSchemaQuery(ref));
};

/** Runs `sql` into a table-results panel (reused when the serializer hands one back). */
async function openSqlPanel(title: string, existingPanel: vscode.WebviewPanel | undefined, conn: ConnectionRef, sql: string): Promise<void> {
	const panel = existingPanel && existingPanel.viewType === TABLE_RESULTS_VIEW_TYPE
		? existingPanel
		: vscode.window.createWebviewPanel(TABLE_RESULTS_VIEW_TYPE, title, { viewColumn: vscode.ViewColumn.Active }, { enableFindWidget: true, enableScripts: true, retainContextWhenHidden: true });

	const resultsGridRender = new ResultsGridRender(panel);
	await resultsGridRender.render1();
	await runSqlQuery(resultsGridRender, conn, sql, Date.now(), false);
}

export const commandCreateTableDefaultQuery = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.name) { return; }

	const doc = await vscode.workspace.openTextDocument({
		language: 'bqsql',
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
		const doc = await vscode.workspace.openTextDocument({ language: 'bqsql', content: definition });
		await vscode.commands.executeCommand<vscode.TextDocumentShowOptions>("vscode.open", doc.uri);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Open definition failed: ${error?.message ?? error}`);
	}
};

export const commandSetDefaultProject = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.conn) { return; }
	await setActiveConnection(ref.conn);
	vscode.commands.executeCommand(COMMAND_EXPLORER_REFRESH);
};

export const commandDownloadCsv = async function (this: any, ...args: any[]) {

	if (args.length > 0) {

		let data = args[0];
		if (data.command === "download_csv") {

			if (data.jobReference || data.tableReference) {

				const bqClient = await getBigQueryClient();

				if (data.jobReference) {
					let jobReference = data.jobReference;
					await DownloadCsv.download(bqClient, jobReference);
				} else {
					let tableReference = data.tableReference;

					const table = bqClient.getTable(tableReference.projectId, tableReference.datasetId, tableReference.tableId);


					await DownloadCsv.downloadTable(bqClient, table);
				}
			}

		}

	}

	// const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

	// if (activeTab === undefined || activeTab.input === undefined) {
	// 	return;
	// }
	// const bqClient = await getBigQueryClient();

	// const viewType = ((activeTab.input as any).viewType as string);
	// if (viewType?.endsWith('-bigquery-query-results')) {

	// 	const uuid = activeTab.label.substring(activeTab.label.length - 8);

	// 	const globalState: vscode.Memento = this.globalState;
	// 	let queryResultsMapping: QueryResultsMapping[] | undefined = globalState.get('queryResultsMapping');
	// 	if (queryResultsMapping) {

	// 		const item = queryResultsMapping.find(c => c.uuid === uuid);
	// 		if (item && item.jobReferences && item.jobIndex !== undefined) {
	// 			await DownloadCsv.download(bqClient, item.jobReferences[item.jobIndex]);
	// 		}
	// 	}
	// } else {
	// 	if (viewType?.endsWith('-bigquery-table-results')) {

	// 		const tableId = activeTab.label.split('.');
	// 		const table = bqClient.getTable(tableId[0], tableId[1], tableId[2]);

	// 		await DownloadCsv.downloadTable(bqClient, table);

	// 	}
	// }


};

export const commandDownloadJsonl = async function (this: any, ...args: any[]) {

	if (args.length > 0) {

		let data = args[0];
		if (data.command === "download_jsonl") {

			if (data.jobReference || data.tableReference) {

				const bqClient = await getBigQueryClient();

				if (data.jobReference) {
					let jobReference = data.jobReference;
					await DownloadJsonl.download(bqClient, jobReference);
				} else {
					let tableReference = data.tableReference;

					const table = bqClient.getTable(tableReference.projectId, tableReference.datasetId, tableReference.tableId);


					await DownloadJsonl.downloadTable(bqClient, table);
				}
			}


			// const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

			// if (activeTab === undefined || activeTab.input === undefined) {
			// 	return;
			// }

			// const viewType = ((activeTab.input as any).viewType as string);
			// const bqClient = await getBigQueryClient();

			// if (viewType?.endsWith('-bigquery-query-results')) {

			// 	const uuid = activeTab.label.substring(activeTab.label.length - 8);

			// 	const globalState: vscode.Memento = this.globalState;
			// 	let queryResultsMapping: QueryResultsMapping[] | undefined = globalState.get('queryResultsMapping');
			// 	if (queryResultsMapping) {

			// 		const item = queryResultsMapping.find(c => c.uuid === uuid);
			// 		if (item && item.jobReferences && item.jobIndex !== undefined) {
			// 			await DownloadJsonl.download(bqClient, item.jobReferences[item.jobIndex]);
			// 		}
			// 	}
			// } else {
			// 	if (viewType?.endsWith('-bigquery-table-results')) {

			// 		const tableId = activeTab.label.split('.');
			// 		const table = bqClient.getTable(tableId[0], tableId[1], tableId[2]);

			// 		await DownloadJsonl.downloadTable(bqClient, table);

			// 	}
			// }

		}
	}
};

export const commandCopyToClipboard = async function (this: any, ...args: any[]) {

	if (args.length > 0) {

		let data = args[0];
		if (data.command === "copy_to_clipboard") {

			if (data.jobReference || data.tableReference) {

				const bqClient = await getBigQueryClient();

				if (data.jobReference) {
					let jobReference = data.jobReference;
					await CopyToClipboard.copy(bqClient, jobReference);
				} else {
					let tableReference = data.tableReference;

					const table = bqClient.getTable(tableReference.projectId, tableReference.datasetId, tableReference.tableId);

					await CopyToClipboard.copyTable(bqClient, table);
				}
			}
		}
	}
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

function warnNoConnection(): void {
	vscode.window.showWarningMessage('No connection configured. Add one in settings (vscode-bigquery.connections).', 'Open Settings')
		.then(c => { if (c) { vscode.commands.executeCommand(OPEN_SETTING_CONNECTIONS); } });
}

// ---- T-SQL execution (Fabric Warehouse / Lakehouse SQL endpoint, Azure SQL, SQL Server) ----

async function runSqlQuery(resultsGridRender: ResultsGridRender, conn: ConnectionRef, queryText: string, queryStartTime: number, recordHistory = true): Promise<number> {
	await resultsGridRender.postMessage({
		requestType: ResultsGridRenderRequestV2Type.clear.toString(),
		projectId: null, token: null, job: null, error: null
	} as ResultsGridRenderRequestV2);

	try {
		const maxRows = vscode.workspace.getConfiguration('vscode-bigquery').get<number>('maxRows', 100000);
		const result = await clientFor(conn).runQuery(queryText, maxRows);

		const msg: SqlResultMessage = { requestType: 'sql_result', resultId: result.id, sets: result.sets, elapsedMs: result.elapsedMs };
		await resultsGridRender.postMessage(msg);

		if (recordHistory) {
			await queryHistoryService?.addEntry({
				query: queryText, timestamp: queryStartTime, bytesProcessed: 0,
				durationMs: Date.now() - queryStartTime, projectId: conn.id, status: 'success'
			});
		}
		return result.sets.length;
	} catch (errorx: any) {
		const message = errorx?.message || 'undefined message';
		await resultsGridRender.postMessage({
			requestType: ResultsGridRenderRequestV2Type.error.toString(),
			projectId: null, token: null, job: null,
			error: { message, reason: errorx?.number ? `SQL error ${errorx.number}` : '' }
		} as ResultsGridRenderRequestV2);
		if (recordHistory) {
			await queryHistoryService?.addEntry({
				query: queryText, timestamp: queryStartTime, bytesProcessed: 0,
				durationMs: Date.now() - queryStartTime, projectId: conn.id, status: 'error', errorMessage: message
			});
		}
		return 0;
	}
}

let bigQueryClient: BigQueryClient | null;

export const getBigQueryClient = async function (): Promise<BigQueryClient> {
	if (!bigQueryClient) {
		const t1 = Date.now();
		const projectId = await Authentication.getDefaultProjectId();
		bigQueryClient = new BigQueryClient(projectId);
	}

	return bigQueryClient;
};

const resetBigQueryClient = function () {
	disposeAllClients();
	bigQueryClient = null;
};

export const commandFormatQuery = async function () {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	const document = editor.document;
	const text = document.getText();

	try {
		const formatted = formatBigQuerySQL(text);

		// Replace entire document with formatted text
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);

		await editor.edit(editBuilder => {
			editBuilder.replace(fullRange, formatted);
		});
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to format SQL: ${error.message}`);
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

// Query History
let queryHistoryService: QueryHistoryService | null = null;

export function initQueryHistoryService(globalState: vscode.Memento): QueryHistoryService {
	if (!queryHistoryService) {
		queryHistoryService = new QueryHistoryService(globalState);
	}
	return queryHistoryService;
}

export function getQueryHistoryService(): QueryHistoryService | null {
	return queryHistoryService;
}

// Helper to extract QueryHistoryItem from either direct item or TreeItem
function extractHistoryItem(arg: any): QueryHistoryItem | null {
	if (!arg) {return null;}
	// If it's a TreeItem with historyItem property
	if (arg.historyItem) {return arg.historyItem;}
	// If it's the QueryHistoryItem directly
	if (arg.query && arg.timestamp) {return arg;}
	return null;
}

export const commandHistoryRerun = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.query) {
		return;
	}

	// Create a new untitled document with the query
	const doc = await vscode.workspace.openTextDocument({
		language: 'bqsql',
		content: item.query
	});
	await vscode.window.showTextDocument(doc);

	// Run the query
	vscode.commands.executeCommand(COMMAND_RUN_QUERY);
};

export const commandHistoryCopy = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.query) {
		return;
	}
	await vscode.env.clipboard.writeText(item.query);
	vscode.window.showInformationMessage('Query copied to clipboard');
};

export const commandHistoryShow = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.query) {
		return;
	}

	// Create a new untitled document with the query (read-only preview)
	const doc = await vscode.workspace.openTextDocument({
		language: 'bqsql',
		content: item.query
	});
	await vscode.window.showTextDocument(doc, { preview: true });
};

// Server-side Job History: click → open the job's SQL (or a summary when it has none).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commandJobHistoryShow = async function (arg: any) {
	const entry = arg?.entry;
	if (!entry) { return; }
	const content = entry.query
		?? [
			`-- Job ${entry.jobReference.jobId}`,
			`-- Type: ${entry.jobType}${entry.statementType ? ' / ' + entry.statementType : ''}`,
			`-- State: ${entry.state}${entry.errorMessage ? '\n-- Error: ' + entry.errorMessage : ''}`,
		].join('\n');
	const doc = await vscode.workspace.openTextDocument({ language: 'bqsql', content });
	await vscode.window.showTextDocument(doc, { preview: true });
};

// Server-side Job History: execution details panel (errors, plan stages, timeline, stats).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commandJobHistoryDetails = async function (arg: any) {
	const ref = arg?.entry?.jobReference;
	if (!ref?.jobId || !ref?.projectId) { return; }
	try {
		const client = new BigQueryClient(ref.projectId);
		const [metadata] = await client.getJob(ref).getMetadata();
		const details = buildJobDetails(metadata);
		const panel = vscode.window.createWebviewPanel(
			'bigquery-job-details',
			`Job Details: ${String(ref.jobId).slice(-8)}`,
			{ viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
			{ enableFindWidget: true, enableScripts: false }
		);
		panel.webview.html = renderJobDetailsHtml(details);
	} catch (err) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vscode.window.showErrorMessage(`Could not load job details: ${(err as any)?.message ?? err}`);
	}
};

// Server-side Job History: open a finished job's result set in the standard grid panel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commandJobHistoryOpenResults = async function (arg: any) {
	const entry = arg?.entry;
	const ref = entry?.jobReference;
	if (!ref?.jobId || !ref?.projectId) { return; }
	try {
		const client = new BigQueryClient(ref.projectId);
		const job = client.getJob(ref);
		const [metadata] = await job.getMetadata();
		const token = await client.getToken();

		const shortId = String(ref.jobId).slice(-8);
		const panel = vscode.window.createWebviewPanel(
			QUERY_RESULTS_VIEW_TYPE,
			`Job: ${shortId}`,
			{ viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
			{ enableFindWidget: true, enableScripts: true, retainContextWhenHidden: true }
		);
		const render = new ResultsGridRender(panel);
		await render.render1();
		await render.postMessage({
			requestType: ResultsGridRenderRequestV2Type.executeQuery.toString(),
			projectId: ref.projectId,
			token: token,
			job: metadata,
			error: null
		} as ResultsGridRenderRequestV2);
	} catch (err) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vscode.window.showErrorMessage(`Could not open job results: ${(err as any)?.message ?? err}`);
	}
};

export const commandHistoryDelete = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.id || !queryHistoryService) {
		return;
	}
	await queryHistoryService.removeEntry(item.id);
};

export const commandHistoryClear = async function () {
	if (!queryHistoryService) {
		return;
	}

	const confirm = await vscode.window.showWarningMessage(
		'Clear all query history?',
		{ modal: true },
		'Clear'
	);

	if (confirm === 'Clear') {
		await queryHistoryService.clearHistory();
		vscode.window.showInformationMessage('Query history cleared');
	}
};

// Data Lineage
export const commandShowLineage = function (context: vscode.ExtensionContext) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor with SQL query');
		return;
	}

	const text = editor.document.getText();
	if (!text.trim()) {
		vscode.window.showErrorMessage('No SQL query in the active editor');
		return;
	}

	try {
		const result = buildMultiQueryLineage(text);
		const queriesWithLineage = result.queries.filter(q => q.graph.nodes.length > 0);

		if (queriesWithLineage.length === 0) {
			vscode.window.showInformationMessage('No table references found in any queries');
			return;
		}

		showMultiLineagePanel(result, context);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to analyze lineage: ${error.message}`);
	}
};

// Data Lineage for Selection
export const commandShowLineageSelection = function (context: vscode.ExtensionContext) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor with SQL query');
		return;
	}

	if (editor.selection.isEmpty) {
		vscode.window.showErrorMessage('No text selected. Please select a SQL query.');
		return;
	}

	const text = editor.document.getText(editor.selection);
	if (!text.trim()) {
		vscode.window.showErrorMessage('Selected text is empty');
		return;
	}

	try {
		const result = buildMultiQueryLineage(text);
		const queriesWithLineage = result.queries.filter(q => q.graph.nodes.length > 0);

		if (queriesWithLineage.length === 0) {
			vscode.window.showInformationMessage('No table references found in selection');
			return;
		}

		showMultiLineagePanel(result, context);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to analyze lineage: ${error.message}`);
	}
};

// Refresh Schema Cache
export const commandRefreshSchemaCache = function (...args: any[]) {
	const cachedCount = bigqueryTableSchemaService.getCachedTableCount();
	bigqueryTableSchemaService.clearCache();

	if (cachedCount > 0) {
		vscode.window.showInformationMessage(`BigQuery: Schema cache cleared (${cachedCount} table${cachedCount === 1 ? '' : 's'} removed)`);
	} else {
		vscode.window.showInformationMessage('BigQuery: Schema cache was already empty');
	}
};

// Open current SQL file as a BigQuery notebook (inline results)
export const commandOpenAsNotebook = async function (uri?: vscode.Uri) {
	const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
	if (!targetUri) {
		vscode.window.showWarningMessage('Open a .sql or .bqsql file first.');
		return;
	}

	// Unsaved (untitled) buffers have no file for the notebook serializer to read —
	// vscode.openWith would yield an empty notebook. Build the notebook directly from the
	// text buffer and open it as an untitled notebook instead.
	if (targetUri.scheme === 'untitled') {
		if (typeof vscode.window.showNotebookDocument !== 'function') {
			vscode.window.showWarningMessage('Save the file first to open it as a notebook (this VS Code version cannot convert unsaved buffers).');
			return;
		}
		const textDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === targetUri.toString());
		const notebook = await vscode.workspace.openNotebookDocument(
			'bigquery-sql-notebook',
			textToNotebookData(textDoc?.getText() ?? '')
		);
		await vscode.window.showNotebookDocument(notebook);
		return;
	}

	await vscode.commands.executeCommand('vscode.openWith', targetUri, 'bigquery-sql-notebook');
};

// Open current notebook as a plain text editor
export const commandOpenAsText = async function (uri?: vscode.Uri) {
	const targetUri = uri || vscode.window.activeNotebookEditor?.notebook.uri;
	if (!targetUri) {
		vscode.window.showWarningMessage('No notebook is currently active.');
		return;
	}

	// Close the specific notebook tab (not the active editor) so reopening
	// the same URI switches from notebook to text instead of revealing.
	const uriStr = targetUri.toString();
	const notebookTabs = vscode.window.tabGroups.all
		.flatMap(g => g.tabs)
		.filter(t => t.input instanceof vscode.TabInputNotebook && t.input.uri.toString() === uriStr);

	for (const tab of notebookTabs) {
		await vscode.window.tabGroups.close(tab);
	}

	const doc = await vscode.workspace.openTextDocument(targetUri);
	await vscode.window.showTextDocument(doc, { preview: false });
};

// Toggle Lineage Export Theme
export const commandSetLineageExportTheme = async function (...args: any[]) {
	const config = vscode.workspace.getConfiguration('vscode-bigquery');
	const currentTheme = config.get<string>('lineageExportTheme', 'dark');

	// Toggle between dark and light
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

	await config.update('lineageExportTheme', newTheme, vscode.ConfigurationTarget.Global);

	const themeDescription = newTheme === 'dark'
		? 'dark background with light text'
		: 'white background with dark text';

	vscode.window.showInformationMessage(`BigQuery: Lineage export theme switched to ${newTheme} (${themeDescription})`);
};

// Sign out (via Command Palette or the Authentication view)
export const commandRevokeSession = async function (...args: any[]) {
	try {
		resetBigQueryClient();
		await signOut();
		vscode.window.showInformationMessage('Signed out. To remove the Microsoft account entirely, use the VS Code Accounts menu.');
		vscode.commands.executeCommand(COMMAND_AUTHENTICATION_REFRESH);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to sign out: ${error.message || error}`);
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

	const quoted = vscode.workspace.getConfiguration('vscode-bigquery').get<boolean>('copyTablePathBackticks', true);
	const tablePath = quoted ? qualifiedName(ref) : displayName(ref);
	await vscode.env.clipboard.writeText(tablePath);
	vscode.window.showInformationMessage(`Copied: ${tablePath}`);
};

/**
 * Scans globalState, reports each key's size, and offers to wipe.
 * Falls back to a known-keys list when Memento.keys() is empty/unsupported.
 */
const KNOWN_GLOBAL_STATE_KEYS = [
	'bqsql-notebook-cells',
	'bigquery-table-index',
	'queryResultsMapping',
	'queryResultsChartMapping',
	'bigquery-query-history',
];

export const commandClearExtensionCache = function (globalState: vscode.Memento) {
	return async function () {
		try {
			let keys: readonly string[] = [];
			try { keys = globalState.keys() || []; } catch { keys = []; }
			if (!keys.length) { keys = KNOWN_GLOBAL_STATE_KEYS; }
			const merged = Array.from(new Set([...keys, ...KNOWN_GLOBAL_STATE_KEYS]));

			const sizes: Array<{ key: string; bytes: number }> = [];
			for (const key of merged) {
				try {
					const value = globalState.get(key);
					if (value === undefined) { continue; }
					sizes.push({ key, bytes: JSON.stringify(value).length });
				} catch { /* skip */ }
			}
			sizes.sort((a, b) => b.bytes - a.bytes);
			const report = sizes.length
				? sizes.map(s => `${s.key}: ${(s.bytes / 1024 / 1024).toFixed(2)} MB`).join('\n')
				: '(no enumerable keys found)';
			const total = sizes.reduce((acc, s) => acc + s.bytes, 0);
			const choice = await vscode.window.showWarningMessage(
				`BigQuery extension globalState: ${(total / 1024 / 1024).toFixed(1)} MB across ${sizes.length} enumerable keys.\n\n${report}\n\nWipe ALL ${sizes.length} keys?`,
				{ modal: true },
				'Wipe All', 'Cancel'
			);
			if (choice === 'Wipe All') {
				for (const entry of sizes) {
					await globalState.update(entry.key, undefined);
				}
				vscode.window.showInformationMessage(`Cleared ${sizes.length} key(s), ${(total / 1024 / 1024).toFixed(1)} MB freed. Reload window.`);
			}
		} catch (err) {
			vscode.window.showErrorMessage(`Clear cache failed: ${(err as any)?.message || err}`);
		}
	};
};
