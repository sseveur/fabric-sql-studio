import * as vscode from 'vscode';
import { clientFor, storeResult } from '../services/sqlServerClient';
import { SqlResultMessage, SqlClearMessage, SqlErrorMessage } from '../tableResultsPanel/resultContract';
import { clearSqlDiagnostics, reportSqlError, showQueryStatus } from '../language/sqlDiagnostics';
import { QUERY_RESULTS_VIEW_TYPE, TABLE_RESULTS_VIEW_TYPE } from '../extension';
import { getActiveConnection, getConnection } from '../services/connections';
import { connectionForDatabase, pickConnectionFor } from '../services/queryRouter';
import { ConnectionRef, ObjectRef, displayName, refToKey } from '../services/objectRef';
import { QueryGeneratorService } from '../services/queryGeneratorService';
import { ResultsGridRender } from '../tableResultsPanel/resultsGridRender';
import { randomUUID as uuidv4 } from 'crypto';
import { QueryResultsMappingService } from '../services/queryResultsMappingService';
import { ResultsRender } from '../services/resultsRender';
import { QueryResultsVisualizationType } from '../services/queryResultsVisualizationType';
import { ExportKind, exportSqlResult } from '../tableResultsPanel/sqlExport';
import { formatFabricSqlSQL, formatErrorSummary } from '../language/fsqlFormatter';
import { runColumnProfileForTable } from '../services/columnProfile';
import { showColumnProfilePanel } from '../tableResultsPanel/columnProfilePanel';
import { resolveColumnAtPosition, ResolvedColumn, resolveCteAtPosition, resolveTableAtPosition } from '../services/columnResolver';
import { extractCtePreviews } from '../services/ctePreview';
import { extractLineage } from '../services/lineageService';
import { getSparkTarget, pickSparkTarget, runSparkSql, stopSparkSessions } from '../services/sparkClient';
import { getQueryHistoryService } from './history';
import { COMMAND_PREVIEW_CTE, COMMAND_SELECT_SPARK_LAKEHOUSE, OPEN_SETTING_CONNECTIONS } from './ids';

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
		await getQueryHistoryService()?.addEntry({ query: queryText, timestamp: queryStartTime, bytesProcessed: 0, durationMs: Date.now() - queryStartTime, projectId: `spark:${t.label}`, status: 'success' });
		return sets.length;
	} catch (e: any) {
		const message = e?.message ?? String(e);
		showQueryStatus(`$(error) Spark error · ${t.label}`, message);
		await resultsGridRender.postMessage({ requestType: 'error', error: { message, reason: `Spark · ${t.label}` } } as SqlErrorMessage);
		if (/TABLE_OR_VIEW_NOT_FOUND|SCHEMA_NOT_FOUND/.test(message)) {
			vscode.window.showWarningMessage(`Table not found on ${t.label}. Schema-enabled lakehouses need schema.table.`, 'Switch Lakehouse')
				.then(choice => { if (choice) { void vscode.commands.executeCommand(COMMAND_SELECT_SPARK_LAKEHOUSE); } });
		}
		await getQueryHistoryService()?.addEntry({ query: queryText, timestamp: queryStartTime, bytesProcessed: 0, durationMs: Date.now() - queryStartTime, projectId: `spark:${t.label}`, status: 'error', errorMessage: message });
		return 0;
	}
}

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

export function warnNoConnection(): void {
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
			await getQueryHistoryService()?.addEntry({
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
			await getQueryHistoryService()?.addEntry({
				query: queryText, timestamp: queryStartTime, bytesProcessed: 0,
				durationMs: Date.now() - queryStartTime, projectId: conn.id, status: 'error', errorMessage: message
			});
		}
		return 0;
	}
}

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
