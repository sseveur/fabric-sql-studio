import * as vscode from 'vscode';
import { clientFor, disposeAllClients, storeResult } from './services/sqlServerClient';
import { SqlResultMessage, SqlClearMessage, SqlErrorMessage } from './tableResultsPanel/resultContract';
import { clearSqlDiagnostics, reportSqlError, showQueryStatus } from './language/sqlDiagnostics';
import { sqlTreeDataProvider, QUERY_RESULTS_VIEW_TYPE, TABLE_RESULTS_VIEW_TYPE, authenticationWebviewProvider, tableSchemaService } from './extension';
import { describeToken, getAccessToken, SCOPE_FABRIC, SCOPE_TDS, signIn, signOut } from './services/auth';
import { getActiveConnection, getConnection, getConnections, pinObject, setActiveConnection, unpinObject, SETTING_CONNECTIONS } from './services/connections';
import { listSqlItems, listWorkspaces } from './services/fabricClient';
import { pickConnectionFor } from './services/queryRouter';
import { ConnectionRef, ObjectRef, displayName, qualifiedName, refToKey } from './services/objectRef';
import { SchemaRender } from './tableResultsPanel/schemaRender';
import { QueryGeneratorService } from './services/queryGeneratorService';
import { ResultsGridRender } from './tableResultsPanel/resultsGridRender';
import { randomUUID as uuidv4 } from 'crypto';
import { QueryResultsMappingService } from './services/queryResultsMappingService';
import { QueryResultsMapping } from './services/queryResultsMapping';
// import { JobReference } from "./services/queryResultsMapping";
import { ResultsRender } from './services/resultsRender';
import { QueryResultsVisualizationType } from './services/queryResultsVisualizationType';
import { ExportKind, exportSqlResult } from './tableResultsPanel/sqlExport';
import { formatFabricSqlSQL, formatErrorSummary } from './language/fsqlFormatter';
import { renderRequestDetailsHtml } from './activitybar/jobDetailsPanel';
import { formatEstimate, parsePlanEstimate, parsePlanStatements, prettyXml, renderPlanHtml } from './services/planEstimate';
import { textToNotebookData } from './notebook/fsqlNotebookSerializer';
import { QueryHistoryItem, QueryHistoryService } from './services/queryHistoryService';
import { TableIndexService } from './services/tableIndexService';
import { buildMultiQueryLineage } from './services/lineageGraph';
import { showMultiLineagePanel } from './lineage/lineageWebviewProvider';
import { runColumnProfileForTable } from './services/columnProfile';
import { showColumnProfilePanel } from './tableResultsPanel/columnProfilePanel';
import { resolveColumnAtPosition, ResolvedColumn, resolveCteAtPosition, resolveTableAtPosition } from './services/columnResolver';
import { extractCtePreviews } from './services/ctePreview';
import { extractLineage } from './services/lineageService';
import { getSparkTarget, pickSparkTarget, runSparkSql, stopSparkSessions } from './services/sparkClient';
import { connectionForDatabase } from './services/queryRouter';

export const COMMAND_CLEAR_EXTENSION_CACHE = "fabricSql.clear-extension-cache";
export const COMMAND_RUN_QUERY = "fabricSql.run-query";
export const COMMAND_RUN_SELECTED_QUERY = "fabricSql.run-selected-query";
export const COMMAND_RUN_SPARK_QUERY = "fabricSql.run-spark-query";
export const COMMAND_STOP_SPARK_SESSION = "fabricSql.stop-spark-session";
export const COMMAND_SELECT_SPARK_LAKEHOUSE = "fabricSql.select-spark-lakehouse";
export const COMMAND_PREVIEW_CTE = "fabricSql.preview-cte";
export const COMMAND_PROFILE_COLUMN = "fabricSql.profile-column";
export const COMMAND_PREVIEW_TABLE_AT_CURSOR = "fabricSql.preview-table-at-cursor";
export const COMMAND_USER_LOGIN = "fabricSql.user-login";
export const COMMAND_AUTH_TOKEN_INFO = "fabricSql.auth-token-info";
export const COMMAND_AUTHENTICATION_REFRESH = "fabricSql.authentication-refresh";
export const COMMAND_EXPLORER_REFRESH = "fabricSql.explorer-refresh";
export const COMMAND_VIEW_TABLE = "fabricSql.view-table";
export const COMMAND_VIEW_TABLE_SCHEMA = "fabricSql.view-table-schema";
export const COMMAND_CREATE_TABLE_DEFAULT_QUERY = "fabricSql.create-table-default-query";
export const COMMAND_OPEN_DDL = "fabricSql.open-ddl";
export const COMMAND_SET_DEFAULT_PROJECT = "fabricSql.set-default-project";
export const COMMAND_DOWNLOAD_CSV = "fabricSql.download-csv";
export const COMMAND_DOWNLOAD_JSONL = "fabricSql.download-jsonl";
export const COMMAND_COPY_CLIPBOARD = "fabricSql.copy-to-clipboard";
export const OPEN_SETTING_CONNECTIONS = "fabricSql.open-settings-connections";
export const COMMAND_ADD_FABRIC_CONNECTION = "fabricSql.add-fabric-connection";
export const COMMAND_FORMAT_QUERY = "fabricSql.format-query";
export const COMMAND_HISTORY_RERUN = "fabricSql.history-rerun";
export const COMMAND_HISTORY_COPY = "fabricSql.history-copy";
export const COMMAND_HISTORY_CLEAR = "fabricSql.history-clear";
export const COMMAND_HISTORY_SHOW = "fabricSql.history-show";
export const COMMAND_HISTORY_DELETE = "fabricSql.history-delete";
export const COMMAND_JOB_HISTORY_SHOW = "fabricSql.job-history-show";
export const COMMAND_JOB_HISTORY_REFRESH = "fabricSql.job-history-refresh";
export const COMMAND_JOB_HISTORY_TOGGLE_ALL_USERS = "fabricSql.job-history-toggle-all-users";
export const COMMAND_JOB_HISTORY_LOAD_MORE = "fabricSql.job-history-load-more";
export const COMMAND_JOB_HISTORY_DETAILS = "fabricSql.job-history-details";
export const COMMAND_EXPLAIN_QUERY = "fabricSql.explain-query";
export const COMMAND_EXPLAIN_QUERY_XML = "fabricSql.explain-query-xml";
export const COMMAND_HISTORY_REFRESH = "fabricSql.history-refresh";
export const COMMAND_SHOW_LINEAGE = "fabricSql.show-lineage";
export const COMMAND_SHOW_LINEAGE_SELECTION = "fabricSql.show-lineage-selection";
export const COMMAND_REFRESH_SCHEMA_CACHE = "fabricSql.refresh-schema-cache";
export const COMMAND_SET_LINEAGE_EXPORT_THEME = "fabricSql.set-lineage-export-theme";
export const COMMAND_REVOKE_SESSION = "fabricSql.revoke-session";
export const COMMAND_PIN_TABLE = "fabricSql.pin-table";
export const COMMAND_UNPIN_TABLE = "fabricSql.unpin-table";
export const COMMAND_SEARCH_TABLES = "fabricSql.search-tables";
export const COMMAND_CLEAR_SEARCH = "fabricSql.clear-search";
export const COMMAND_COPY_TABLE_PATH = "fabricSql.copy-table-path";
export const COMMAND_BUILD_TABLE_INDEX = "fabricSql.build-table-index";
export const COMMAND_OPEN_AS_NOTEBOOK = "fabricSql.open-as-notebook";
export const COMMAND_OPEN_AS_TEXT = "fabricSql.open-as-text";

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

/** Selection (or whole editor) as Spark SQL on the chosen lakehouse's Livy session. */
export const commandRunSparkQuery = async function (this: any, ...args: any[]) {
	const editor = vscode.window.activeTextEditor;
	return commandQuery(this, editor && !editor.selection.isEmpty ? RunQueryType.selectedQuery : RunQueryType.query, 'spark');
};

export const commandStopSparkSession = async function () {
	const n = await stopSparkSessions();
	vscode.window.showInformationMessage(n ? 'Spark session stopped.' : 'No Spark session is running.');
};

export const commandSelectSparkLakehouse = async function () {
	try {
		const t = await pickSparkTarget();
		if (t) { vscode.window.showInformationMessage(`Spark queries will run on ${t.label}.`); }
	} catch (e: any) {
		vscode.window.showErrorMessage(`Could not list lakehouses: ${e?.message ?? e}`);
	}
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

	const conn = getActiveConnection();
	if (!conn) { return warnNoConnection(); }

	let resolved: ResolvedColumn | null = null;
	try {
		resolved = await resolveColumnAtPosition(sql, offset, conn.database);
	} catch (err) {
		vscode.window.showErrorMessage(`Profile column: ${(err as Error).message || err}`);
		return;
	}

	if (!resolved) {
		vscode.window.showWarningMessage('Place the cursor on a column name (or `alias.column`) before running Profile Column.');
		return;
	}

	const target = resolved;
	const subtitle = `${target.database}.${target.schema}.${target.table}.${target.columnName} · ${target.columnType}`;
	const owner = (await connectionForDatabase(target.database)) ?? conn;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Profiling \`${target.columnName}\`…`, cancellable: false },
		async () => {
			try {
				const profile = await runColumnProfileForTable(owner, target, target.columnName, target.columnType);
				showColumnProfilePanel(profile, subtitle);
			} catch (err) {
				vscode.window.showErrorMessage(`Profile failed: ${(err as Error).message || err}`);
			}
		}
	);

};

/**
 * Right-click → "Fabric SQL: Preview Table". Resolves the table reference under the
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

	const resolved = resolveTableAtPosition(sql, offset, conn.database);
	if (!resolved) {
		// A CTE (or its alias) has no catalog entry — preview it the way the CodeLens does.
		const cte = resolveCteAtPosition(sql, offset);
		const limit = vscode.workspace.getConfiguration('fabricSql').get<number>('ctePreviewRowLimit', 100);
		const preview = cte ? extractCtePreviews(sql, limit).find(p => p.name.toLowerCase() === cte.toLowerCase()) : undefined;
		if (preview) {
			await vscode.commands.executeCommand(COMMAND_PREVIEW_CTE, preview.previewSql, preview.name);
			return;
		}
		vscode.window.showWarningMessage('Place the cursor on a table name, a CTE name, or an alias before running Preview Table.');
		return;
	}

	// The database may belong to another profile (Fabric: another workspace) — route like queries do.
	const owner = (await connectionForDatabase(resolved.database)) ?? conn;
	const ref: ObjectRef = { conn: owner.id, database: resolved.database, schema: resolved.schema, name: resolved.table, kind: 'table' };
	await commandViewTable({ ref });
};

enum RunQueryType {
	query = 1,
	selectedQuery = 2
}

const commandQuery = async function (local: any, queryType: RunQueryType, engine: 'tds' | 'spark' = 'tds') {

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

	const numberOfJobs = await runQuery(globalState, queryResultsWebviewMapping, uuid, activeTab.label, queryText, textEditor.document.uri, engine);


};

const runQuery = async function (globalState: vscode.Memento, queryResultsWebviewMapping: Map<string, ResultsRender>, uuid: string, mainLabel: string, queryText: string, documentUri?: vscode.Uri, engine: 'tds' | 'spark' = 'tds'): Promise<number> {

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

	if (engine === 'spark') { return runSparkQuery(resultsGridRender, queryText, queryStartTime); }

	const route = await pickConnectionFor(queryText);
	if (!route) {
		warnNoConnection();
		return 0;
	}
	return runSqlQuery(resultsGridRender, route.conn, queryText, queryStartTime, true, documentUri, route.routed);
};

async function runSparkQuery(resultsGridRender: ResultsGridRender, queryText: string, queryStartTime: number): Promise<number> {
	let target = getSparkTarget();
	if (!target) {
		try { target = await pickSparkTarget(); } catch (e: any) { vscode.window.showErrorMessage(`Could not list lakehouses: ${e?.message ?? e}`); return 0; }
		if (!target) { return 0; }
	}
	const t = target;
	await resultsGridRender.postMessage({ requestType: 'clear' } as SqlClearMessage);
	const maxRows = vscode.workspace.getConfiguration('fabricSql').get<number>('maxRows', 100000);
	try {
		const sets = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Spark SQL', cancellable: true },
			(progress, token) => runSparkSql(t, queryText, maxRows, token, message => progress.report({ message })));
		const result = storeResult(sets, Date.now() - queryStartTime);
		await resultsGridRender.postMessage({ requestType: 'sql_result', resultId: result.id, sets: result.sets, elapsedMs: result.elapsedMs } as SqlResultMessage);
		const rows = sets.reduce((n, x) => n + x.rows.length, 0);
		showQueryStatus(`$(zap) ${rows.toLocaleString()} rows · ${(result.elapsedMs / 1000).toFixed(1)} s · Spark · ${t.label}`, `${sets.length} statement(s) on the Livy session`);
		await queryHistoryService?.addEntry({ query: queryText, timestamp: queryStartTime, bytesProcessed: 0, durationMs: Date.now() - queryStartTime, projectId: `spark:${t.label}`, status: 'success' });
		return sets.length;
	} catch (e: any) {
		const message = e?.message ?? String(e);
		showQueryStatus(`$(error) Spark error · ${t.label}`, message);
		await resultsGridRender.postMessage({ requestType: 'error', error: { message, reason: `Spark · ${t.label}` } } as SqlErrorMessage);
		await queryHistoryService?.addEntry({ query: queryText, timestamp: queryStartTime, bytesProcessed: 0, durationMs: Date.now() - queryStartTime, projectId: `spark:${t.label}`, status: 'error', errorMessage: message });
		return 0;
	}
}

export const commandUserLogin = async function (...args: any[]) {

	resetFabricSqlClient();

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

	if (!authOutput) { authOutput = vscode.window.createOutputChannel('Fabric SQL Studio: Auth'); }
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

	resetFabricSqlClient();

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

export const commandSetDefaultProject = async function (...args: any[]) {

	const ref: ObjectRef | undefined = args[0]?.ref;
	if (!ref?.conn) { return; }
	await setActiveConnection(ref.conn);
	vscode.commands.executeCommand(COMMAND_EXPLORER_REFRESH);
};

/** Export buttons of the results grid. Payload: `{ command, resultId, setIndex }` from the webview. */
export const commandDownloadCsv = async function (...args: any[]) { await exportFromPayload('csv', args[0]); };
export const commandDownloadJsonl = async function (...args: any[]) { await exportFromPayload('jsonl', args[0]); };
export const commandCopyToClipboard = async function (...args: any[]) { await exportFromPayload('clipboard', args[0]); };

async function exportFromPayload(kind: ExportKind, data: any): Promise<void> {
	if (typeof data?.resultId !== 'string') {
		vscode.window.showWarningMessage('Run a query first, then use the export buttons on its results.');
		return;
	}
	await exportSqlResult(kind, data.resultId, Number(data.setIndex) || 0);
}

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
	vscode.window.showWarningMessage('No connection configured. Add one in settings (fabricSql.connections).', 'Open Settings')
		.then(c => { if (c) { vscode.commands.executeCommand(OPEN_SETTING_CONNECTIONS); } });
}

// ---- T-SQL execution (Fabric Warehouse / Lakehouse SQL endpoint, Azure SQL, SQL Server) ----

async function runSqlQuery(resultsGridRender: ResultsGridRender, conn: ConnectionRef, queryText: string, queryStartTime: number, recordHistory = true, documentUri?: vscode.Uri, routed = false): Promise<number> {
	await resultsGridRender.postMessage({ requestType: 'clear' } as SqlClearMessage);

	try {
		const maxRows = vscode.workspace.getConfiguration('fabricSql').get<number>('maxRows', 100000);
		const result = await clientFor(conn).runQuery(queryText, maxRows);

		const msg: SqlResultMessage = { requestType: 'sql_result', resultId: result.id, sets: result.sets, elapsedMs: result.elapsedMs };
		await resultsGridRender.postMessage(msg);

		clearSqlDiagnostics(documentUri);
		if (recordHistory) {
			const rows = result.sets.reduce((n, s) => n + (s.rowsAffected ?? s.totalRows), 0);
			showQueryStatus(`$(check) ${rows.toLocaleString()} rows · ${(result.elapsedMs / 1000).toFixed(2)} s · ${routed ? 'routed to ' : ''}${conn.id}`,
				`${result.sets.length} result set(s)${routed ? '\nRouted by the database names in the query; the active connection is unchanged.' : ''}`);
		}

		if (recordHistory) {
			await queryHistoryService?.addEntry({
				query: queryText, timestamp: queryStartTime, bytesProcessed: 0,
				durationMs: Date.now() - queryStartTime, projectId: conn.id, status: 'success'
			});
			await previewCreatedTables(queryText, conn);
		}
		return result.sets.length;
	} catch (errorx: any) {
		const message = errorx?.message || 'undefined message';
		reportSqlError(documentUri, errorx);
		if (recordHistory) { showQueryStatus(`$(error) SQL error${errorx?.number ? ' ' + errorx.number : ''} · ${conn.id}`, message); }
		await resultsGridRender.postMessage({
			requestType: 'error',
			error: { message, reason: `${errorx?.number ? `SQL error ${errorx.number} · ` : ''}connection: ${conn.id}` }
		} as SqlErrorMessage);
		if (recordHistory) {
			await queryHistoryService?.addEntry({
				query: queryText, timestamp: queryStartTime, bytesProcessed: 0,
				durationMs: Date.now() - queryStartTime, projectId: conn.id, status: 'error', errorMessage: message
			});
		}
		return 0;
	}
}

const resetFabricSqlClient = function () {
	disposeAllClients();
};

export const commandFormatQuery = async function () {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	const document = editor.document;
	const text = document.getText();

	try {
		const formatted = formatFabricSqlSQL(text);

		// Replace entire document with formatted text
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);

		await editor.edit(editBuilder => {
			editBuilder.replace(fullRange, formatted);
		});
	} catch (error: any) {
		vscode.window.showErrorMessage(formatErrorSummary(error));
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
		language: 'fsql',
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
		language: 'fsql',
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
	const doc = await vscode.workspace.openTextDocument({ language: 'fsql', content });
	await vscode.window.showTextDocument(doc, { preview: true });
};

// Server-side Job History: request details panel (timings, scanned data, CPU, statement text).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commandJobHistoryDetails = async function (arg: any) {
	const entry = arg?.entry;
	if (!entry) { return; }
	const panel = vscode.window.createWebviewPanel(
		'fabric-sql-job-details',
		`Request: ${String(entry.jobReference.jobId).slice(0, 8)}`,
		{ viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
		{ enableFindWidget: true, enableScripts: false }
	);
	panel.webview.html = renderRequestDetailsHtml(entry);
};

/**
 * Estimated execution plan for the editor text (SET SHOWPLAN_XML ON): summary in the status bar,
 * full plan XML in a new editor. Nothing is executed.
 */
export const commandExplainQuery = async function () {
	const editor = vscode.window.activeTextEditor;
	if (!editor) { return; }
	const sql = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
	if (!sql.trim()) { return; }

	const route = await pickConnectionFor(sql);
	if (!route) { return warnNoConnection(); }

	try {
		const xml = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: `Estimating plan on ${route.conn.id}…` },
			() => clientFor(route.conn).explain(sql));
		lastPlanXml = xml;
		const estimate = parsePlanEstimate(xml);
		showQueryStatus(`${formatEstimate(estimate)} · ${route.conn.id}`,
			[`${estimate.statements} statement(s)`, ...estimate.topOperators.map(o => `  ${o}`), ...(estimate.warnings.length ? ['Warnings: ' + estimate.warnings.join(', ')] : [])].join('\n'));

		if (!planPanel) {
			planPanel = vscode.window.createWebviewPanel('fabric-sql-plan', 'Estimated Plan', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableFindWidget: true, enableScripts: false, retainContextWhenHidden: true });
			planPanel.onDidDispose(() => { planPanel = null; });
		} else {
			planPanel.reveal(undefined, true);
		}
		planPanel.webview.html = renderPlanHtml(parsePlanStatements(xml), route.conn.id, xml);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Estimated plan failed: ${error?.message ?? error}`);
	}
};

/** fabricSql.autoPreviewCreatedTables: open a TOP 100 preview of each permanent table the run created. */
async function previewCreatedTables(sql: string, conn: ConnectionRef): Promise<void> {
	if (!vscode.workspace.getConfiguration('fabricSql').get<boolean>('autoPreviewCreatedTables', false)) { return; }
	const created = extractLineage(sql).targets
		.filter(t => (t.statementType === 'CREATE TABLE' || t.statementType === 'SELECT INTO') && !t.table.startsWith('#'));
	// ponytail: cap at 3 panels for scripts that create many tables
	for (const t of created.slice(0, 3)) {
		const database = t.database ?? conn.database;
		if (!database) { continue; }
		const owner = (await connectionForDatabase(database)) ?? conn;
		await commandViewTable({ ref: { conn: owner.id, database, schema: t.schema ?? 'dbo', name: t.table, kind: 'table' } });
	}
}

let planPanel: vscode.WebviewPanel | null = null;
let lastPlanXml: string | null = null;

/** Raw SHOWPLAN XML of the last estimate, indented, for SSMS / plan-viewer users. */
export const commandExplainQueryXml = async function () {
	if (!lastPlanXml) {
		await commandExplainQuery();
		if (!lastPlanXml) { return; }
	}
	const doc = await vscode.workspace.openTextDocument({ language: 'xml', content: prettyXml(lastPlanXml) });
	await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
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
	const cachedCount = tableSchemaService.getCachedTableCount();
	tableSchemaService.clearCache();

	if (cachedCount > 0) {
		vscode.window.showInformationMessage(`Fabric SQL: Schema cache cleared (${cachedCount} table${cachedCount === 1 ? '' : 's'} removed)`);
	} else {
		vscode.window.showInformationMessage('Fabric SQL: Schema cache was already empty');
	}
};

// Open current SQL file as a Fabric SQL notebook (inline results)
export const commandOpenAsNotebook = async function (uri?: vscode.Uri) {
	const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
	if (!targetUri) {
		vscode.window.showWarningMessage('Open a .sql or .fsql file first.');
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
			'fabric-sql-notebook',
			textToNotebookData(textDoc?.getText() ?? '')
		);
		await vscode.window.showNotebookDocument(notebook);
		return;
	}

	await vscode.commands.executeCommand('vscode.openWith', targetUri, 'fabric-sql-notebook');
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
	const config = vscode.workspace.getConfiguration('fabricSql');
	const currentTheme = config.get<string>('lineageExportTheme', 'dark');

	// Toggle between dark and light
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

	await config.update('lineageExportTheme', newTheme, vscode.ConfigurationTarget.Global);

	const themeDescription = newTheme === 'dark'
		? 'dark background with light text'
		: 'white background with dark text';

	vscode.window.showInformationMessage(`Fabric SQL: Lineage export theme switched to ${newTheme} (${themeDescription})`);
};

// Sign out (via Command Palette or the Authentication view)
export const commandRevokeSession = async function (...args: any[]) {
	try {
		resetFabricSqlClient();
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

	const quoted = vscode.workspace.getConfiguration('fabricSql').get<boolean>('copyTablePathBackticks', true);
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
				`Fabric SQL extension globalState: ${(total / 1024 / 1024).toFixed(1)} MB across ${sizes.length} enumerable keys.\n\n${report}\n\nWipe ALL ${sizes.length} keys?`,
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
