import * as vscode from 'vscode';
import { stopSparkSessions } from './services/sparkClient';
import { SparkTreeDataProvider } from './activitybar/sparkTreeDataProvider';
import { Uri, StatusBarItem, ExtensionContext } from 'vscode';
import { AuthenticationWebviewViewProvider } from './activitybar/authenticationWebviewViewProvider';
import { SqlTreeDataProvider } from './activitybar/sqlTreeDataProvider';
import { SETTING_ACTIVE_CONNECTION, SETTING_CONNECTIONS, SETTING_PINNED_OBJECTS } from './services/connections';
import * as commands from './extensionCommands';
import { initTokenHosts } from './services/tokenHosts';
import { FsqlCompletionItemProvider } from './language/fsqlCompletionItemProvider';
import { FsqlDocumentSemanticTokensProvider } from './language/fsqlDocumentSemanticTokensProvider';
import { FsqlInlayHintsProvider } from './language/fsqlInlayHintsProvider';
import { FsqlHoverProvider } from './language/fsqlHoverProvider';
import { FsqlFoldingRangeProvider } from './language/fsqlFoldingRangeProvider';
import { FsqlCtePreviewCodeLensProvider } from './language/fsqlCtePreviewCodeLensProvider';
import { FsqlFormattingProvider } from './language/fsqlFormattingProvider';
import { TableSchemaService } from './services/tableSchemaService';
import { QueryResultsSerializer } from './tableResultsPanel/queryResultsSerializer';
import { QueryResultsMappingService } from './services/queryResultsMappingService';
import { TableResultsSerializer } from './tableResultsPanel/tableResultsSerializer';
import { ResultsRender } from './services/resultsRender';
import { QueryResultsVisualizationType } from './services/queryResultsVisualizationType';
import { isFabricSqlLanguage } from './services/languageUtils';
import { QueryHistoryTreeDataProvider } from './activitybar/queryHistoryTreeDataProvider';
import { JobHistoryTreeDataProvider } from './activitybar/jobHistoryTreeDataProvider';
import { FsqlNotebookSerializer, NOTEBOOK_TYPE } from './notebook/fsqlNotebookSerializer';
import { FsqlNotebookController } from './notebook/fsqlNotebookController';

export const authenticationWebviewProvider = new AuthenticationWebviewViewProvider();
export const sqlTreeDataProvider = new SqlTreeDataProvider();
export const tableSchemaService = new TableSchemaService();

export const QUERY_RESULTS_VIEW_TYPE = "fabric-sql-query-results";
export const TABLE_RESULTS_VIEW_TYPE = "fabric-sql-table-results";

let statusBarInfo: StatusBarItem | null;
export function getStatusBarInfo(): StatusBarItem | null {
	return statusBarInfo;
}

let extensionUri: Uri;
export function getExtensionUri(): Uri {
	return extensionUri;
}

export function activate(context: ExtensionContext) {

	extensionUri = context.extensionUri;
	initTokenHosts(context.globalState);

	let queryResultsWebviewMapping: Map<string, ResultsRender> = new Map<string, ResultsRender>();

	//statusBarInfo
	statusBarInfo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
	context.subscriptions.push(statusBarInfo);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_RUN_QUERY,
			commands.commandRunQuery,
			{
				"globalState": context.globalState,
				queryResultsWebviewMapping: queryResultsWebviewMapping
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_RUN_SELECTED_QUERY,
			commands.commandRunSelectedQuery,
			{
				"globalState": context.globalState,
				queryResultsWebviewMapping: queryResultsWebviewMapping
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_PREVIEW_CTE,
			commands.commandPreviewCte,
			{
				"globalState": context.globalState,
				queryResultsWebviewMapping: queryResultsWebviewMapping
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_PROFILE_COLUMN,
			commands.commandProfileColumn,
			{
				"globalState": context.globalState,
				queryResultsWebviewMapping: queryResultsWebviewMapping
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_PREVIEW_TABLE_AT_CURSOR,
			commands.commandPreviewTableAtCursor
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_USER_LOGIN,
			commands.commandUserLogin
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_AUTH_TOKEN_INFO,
			commands.commandAuthTokenInfo
		)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.COMMAND_RUN_SPARK_QUERY, commands.commandRunSparkQuery,
			{ "globalState": context.globalState, queryResultsWebviewMapping: queryResultsWebviewMapping }),
		vscode.commands.registerCommand(commands.COMMAND_STOP_SPARK_SESSION, commands.commandStopSparkSession),
		vscode.commands.registerCommand(commands.COMMAND_SELECT_SPARK_LAKEHOUSE, commands.commandSelectSparkLakehouse),
		vscode.window.registerTreeDataProvider('fabric-sql-spark', new SparkTreeDataProvider()),
		// Best effort: don't leave a Spark session burning capacity after the window closes.
		{ dispose: () => { void stopSparkSessions(); } },
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_VIEW_TABLE,
			commands.commandViewTable
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_VIEW_TABLE_SCHEMA,
			commands.commandViewTableSchema
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_CREATE_TABLE_DEFAULT_QUERY,
			commands.commandCreateTableDefaultQuery
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_OPEN_DDL,
			commands.commandOpenDdl
		)
	);

	//https://code.visualstudio.com/api/references/when-clause-contexts
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_AUTHENTICATION_REFRESH,
			commands.commandAuthenticationRefresh
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_EXPLORER_REFRESH,
			commands.commandExplorerRefresh
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_USE_CONNECTION,
			commands.commandUseConnection
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_DOWNLOAD_CSV,
			commands.commandDownloadCsv,
			{ "globalState": context.globalState }
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_DOWNLOAD_JSONL,
			commands.commandDownloadJsonl,
			{ "globalState": context.globalState }
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_COPY_CLIPBOARD,
			commands.commandCopyToClipboard
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.OPEN_SETTING_CONNECTIONS,
			commands.commandOpenSettingConnections
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_ADD_FABRIC_CONNECTION,
			commands.commandAddFabricConnection
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_FORMAT_QUERY,
			commands.commandFormatQuery
		)
	);

	// Data Lineage
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_SHOW_LINEAGE,
			() => commands.commandShowLineage(context)
		)
	);

	// Data Lineage for Selection
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_SHOW_LINEAGE_SELECTION,
			() => commands.commandShowLineageSelection(context)
		)
	);

	// Refresh Schema Cache
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_REFRESH_SCHEMA_CACHE,
			commands.commandRefreshSchemaCache
		)
	);

	// Set Lineage Export Theme
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_SET_LINEAGE_EXPORT_THEME,
			commands.commandSetLineageExportTheme
		)
	);

	// Open as Notebook
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_OPEN_AS_NOTEBOOK,
			commands.commandOpenAsNotebook
		)
	);

	// Open as Text (reverse toggle from notebook)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_OPEN_AS_TEXT,
			commands.commandOpenAsText
		)
	);

	// Revoke Session
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_REVOKE_SESSION,
			commands.commandRevokeSession
		)
	);

	// Pin/Unpin Table
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_PIN_TABLE,
			commands.commandPinTable
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_UNPIN_TABLE,
			commands.commandUnpinTable
		)
	);

	// Search/Clear Tables
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_SEARCH_TABLES,
			commands.commandSearchTables
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_CLEAR_SEARCH,
			commands.commandClearSearch
		)
	);

	// Copy Table Path
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_COPY_TABLE_PATH,
			commands.commandCopyTablePath
		)
	);

	// Table Index
	commands.initTableIndexService(context.globalState);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_BUILD_TABLE_INDEX,
			commands.commandBuildTableIndex
		)
	);

	// Query History
	const queryHistoryService = commands.initQueryHistoryService(context.globalState);
	const queryHistoryTreeDataProvider = new QueryHistoryTreeDataProvider(queryHistoryService);

	// Notebook mode: SQL files as notebooks with inline results
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_CLEAR_EXTENSION_CACHE,
			commands.commandClearExtensionCache(context.globalState)
		)
	);

	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer(
			NOTEBOOK_TYPE,
			new FsqlNotebookSerializer(),
			{ transientOutputs: true }
		)
	);
	const notebookController = new FsqlNotebookController(queryHistoryService);
	context.subscriptions.push(notebookController);


	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			'fabric-sql-query-history',
			queryHistoryTreeDataProvider
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_HISTORY_RERUN,
			commands.commandHistoryRerun
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_HISTORY_COPY,
			commands.commandHistoryCopy
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_HISTORY_SHOW,
			commands.commandHistoryShow
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_HISTORY_DELETE,
			commands.commandHistoryDelete
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_HISTORY_CLEAR,
			commands.commandHistoryClear
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.COMMAND_HISTORY_REFRESH,
			() => queryHistoryTreeDataProvider.refresh()
		)
	);

	// Server-side Job History (jobs.list — any client, not just this extension)
	const jobHistoryTreeDataProvider = new JobHistoryTreeDataProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('fabric-sql-job-history', jobHistoryTreeDataProvider),
		vscode.commands.registerCommand(commands.COMMAND_JOB_HISTORY_SHOW, commands.commandJobHistoryShow),
		vscode.commands.registerCommand(commands.COMMAND_JOB_HISTORY_REFRESH, () => jobHistoryTreeDataProvider.refresh()),
		vscode.commands.registerCommand(commands.COMMAND_JOB_HISTORY_TOGGLE_ALL_USERS, () => jobHistoryTreeDataProvider.toggleAllUsers()),
		vscode.commands.registerCommand(commands.COMMAND_JOB_HISTORY_LOAD_MORE, () => jobHistoryTreeDataProvider.loadMore()),
		vscode.commands.registerCommand(commands.COMMAND_JOB_HISTORY_DETAILS, commands.commandJobHistoryDetails),
		vscode.commands.registerCommand(commands.COMMAND_EXPLAIN_QUERY, commands.commandExplainQuery),
		vscode.commands.registerCommand(commands.COMMAND_EXPLAIN_QUERY_XML, commands.commandExplainQueryXml)
	);

	// fabric-sql-authentication
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"fabric-sql-authentication",
			authenticationWebviewProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	//fabric-sql-tree-data-provider
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			'fabric-sql-tree-data-provider',
			sqlTreeDataProvider
		)
	);

	//fabric-sql-query-results
	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(
			QUERY_RESULTS_VIEW_TYPE,
			new QueryResultsSerializer(context.globalState, queryResultsWebviewMapping)
		)
	);

	//fabric-sql-table-results
	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(
			TABLE_RESULTS_VIEW_TYPE,
			new TableResultsSerializer()
		)
	);

	//language

	// Register language providers for both fsql and sql languages
	const completionProvider = new FsqlCompletionItemProvider();
	const semanticTokensProvider = new FsqlDocumentSemanticTokensProvider();
	const inlayHintsProvider = new FsqlInlayHintsProvider();

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ language: 'fsql' },
			completionProvider,
			'.' // Trigger completion when user types '.' for CTE column suggestions
		)
	);
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ language: 'sql' },
			completionProvider,
			'.' // Trigger completion when user types '.' for CTE column suggestions
		)
	);

	context.subscriptions.push(
		vscode.languages.registerDocumentSemanticTokensProvider(
			{ language: 'fsql' },
			semanticTokensProvider,
			FsqlDocumentSemanticTokensProvider.getSemanticTokensLegend()
		)
	);
	context.subscriptions.push(
		vscode.languages.registerDocumentSemanticTokensProvider(
			{ language: 'sql' },
			semanticTokensProvider,
			FsqlDocumentSemanticTokensProvider.getSemanticTokensLegend()
		)
	);

	context.subscriptions.push(
		vscode.languages.registerInlayHintsProvider(
			{ language: 'fsql' },
			inlayHintsProvider
		)
	);
	context.subscriptions.push(
		vscode.languages.registerInlayHintsProvider(
			{ language: 'sql' },
			inlayHintsProvider
		)
	);

	// Hover provider for table schema preview
	const hoverProvider = new FsqlHoverProvider();
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ language: 'fsql' },
			hoverProvider
		)
	);
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ language: 'sql' },
			hoverProvider
		)
	);

	// Folding range provider for collapsing queries
	const foldingRangeProvider = new FsqlFoldingRangeProvider();
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider(
			{ language: 'fsql' },
			foldingRangeProvider
		)
	);
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider(
			{ language: 'sql' },
			foldingRangeProvider
		)
	);

	// CodeLens provider: "Preview CTE" link above each CTE in a WITH clause
	const ctePreviewCodeLensProvider = new FsqlCtePreviewCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: 'fsql' },
			ctePreviewCodeLensProvider
		)
	);
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: 'sql' },
			ctePreviewCodeLensProvider
		)
	);

	// Document formatting provider: wires the SQL formatter into VS Code's
	// standard formatting API (Format Document, context menu, formatOnSave)
	const formattingProvider = new FsqlFormattingProvider();
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			{ language: 'fsql' },
			formattingProvider
		)
	);
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			{ language: 'sql' },
			formattingProvider
		)
	);

	//check if the theme has changed and the tree icons need to change colour
	vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('workbench.colorTheme')) {
			vscode.commands.executeCommand(commands.COMMAND_EXPLORER_REFRESH);
		}
		// Refresh the explorer when its backing settings change from any source
		// (pin/unpin on another machine via Settings Sync, manual settings.json edits) —
		// without this the Pinned Tables folder only updates on explicit refresh.
		if (event.affectsConfiguration(SETTING_CONNECTIONS)
			|| event.affectsConfiguration(SETTING_ACTIVE_CONNECTION)
			|| event.affectsConfiguration(SETTING_PINNED_OBJECTS)) {
			vscode.commands.executeCommand(commands.COMMAND_EXPLORER_REFRESH);
		}
	});

	vscode.window.onDidChangeActiveTextEditor(e => {

		if (e?.document && isFabricSqlLanguage(e.document.languageId)) {

			//check if results tab exist and it's known
			//  is possible that is not know in case that vscode was restarted and that window was not opened
			//  in this scenario, the tab exists but is not possible to determine the correspondent panel
			//  panels are lazy loaded

			const config = vscode.workspace.getConfiguration('fabricSql');
			const autoReveal = config.get('autoRevealResults', true);

			if (autoReveal) {
				[QueryResultsVisualizationType.table].forEach(t => {
					const uuid = QueryResultsMappingService.getQueryResultsMappingUuid(context.globalState, e, t);
					if (uuid) {
						const resultsGridRender = QueryResultsMappingService.getQueryResultsMappingResultsGridRender(queryResultsWebviewMapping, uuid);
						if (resultsGridRender) {
							resultsGridRender.reveal(undefined, true);
						}
					}
				});
			}
		}

	});

}

// this method is called when your extension is deactivated
export function deactivate() { }
