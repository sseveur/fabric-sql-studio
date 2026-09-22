import * as vscode from 'vscode';
import { QueryHistoryService } from '../services/queryHistoryService';
import { NOTEBOOK_TYPE, CELL_LANGUAGE } from './bqSqlNotebookSerializer';
import { sanitizedGridColorVars } from '../tableResultsPanel/resultsGridRender';
import { clientFor, getResultPage } from '../services/sqlServerClient';
import { pickConnectionFor } from '../services/queryRouter';
import { toWireRow } from '../tableResultsPanel/grid/pagination';
import { exportSqlResult, ExportKind } from '../tableResultsPanel/sqlExport';
import { SqlResultSet } from '../tableResultsPanel/resultContract';

const CONTROLLER_ID = 'bigquery-sql-controller';
const CONTROLLER_LABEL = 'SQL (TDS)';
const INITIAL_PAGE_ROWS = 1000;
/** Must match the notebookRenderer id in package.json and the renderer bundle. */
const RENDERER_ID = 'bigquery-grid-renderer';

/** MIME type consumed by the notebook-renderer bundle (resources/notebook-renderer.js). Keep in
 *  sync with GRID_MIME in src/notebook/renderer/index.tsx and the package.json contribution. */
const GRID_MIME = 'application/vnd.bigquery.grid+json';

const EXPORT_KIND: Record<string, ExportKind> = { download_csv: 'csv', download_jsonl: 'jsonl', copy_to_clipboard: 'clipboard' };

/**
 * Runs notebook cells over TDS (same client, routing and result store as the results panel) and
 * renders one grid per result set. Rows beyond the first page and exports are served from the
 * host-held result set through renderer messaging.
 *
 * ponytail: results are not persisted across VS Code restarts — a restored cell shows no output
 * until re-run. That was true of the rows before too; only the job id survived.
 */
export class BqSqlNotebookController implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    private executionOrder = 0;
    private readonly messaging: vscode.NotebookRendererMessaging;
    private readonly messagingListener: vscode.Disposable;

    constructor(private readonly historyService?: QueryHistoryService) {
        this.controller = vscode.notebooks.createNotebookController(CONTROLLER_ID, NOTEBOOK_TYPE, CONTROLLER_LABEL);
        this.controller.supportedLanguages = [CELL_LANGUAGE, 'sql'];
        this.controller.supportsExecutionOrder = true;
        this.controller.executeHandler = this.execute.bind(this);

        this.messaging = vscode.notebooks.createRendererMessaging(RENDERER_ID);
        this.messagingListener = this.messaging.onDidReceiveMessage(async (e) => {
            const m: any = e.message;
            if (!m?.sql?.resultId) { return; }
            if (m.type === 'bq-fetch-page') {
                try {
                    const rows = getResultPage(m.sql.resultId, m.sql.setIndex, m.startIndex, m.pageSize).map(toWireRow);
                    await this.messaging.postMessage({ type: 'bq-page', requestId: m.requestId, rows }, e.editor);
                } catch (err: any) {
                    await this.messaging.postMessage({ type: 'bq-page', requestId: m.requestId, error: err?.message ?? String(err) }, e.editor);
                }
            } else if (m.type === 'bq-export' && EXPORT_KIND[m.command]) {
                await exportSqlResult(EXPORT_KIND[m.command], m.sql.resultId, m.sql.setIndex);
            }
        });
    }

    dispose(): void {
        this.controller.dispose();
        this.messagingListener.dispose();
    }

    private async execute(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, controller: vscode.NotebookController): Promise<void> {
        for (const cell of cells) { await this.executeCell(cell, controller); }
    }

    private async executeCell(cell: vscode.NotebookCell, controller: vscode.NotebookController): Promise<void> {
        const execution = controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        const startTime = Date.now();
        execution.start(startTime);

        const queryText = cell.document.getText().trim();
        if (!queryText) { execution.end(true, Date.now()); return; }

        let connId = 'unknown';
        try {
            const route = await pickConnectionFor(queryText);
            if (!route) { throw new Error('No connection configured. Add one in the Explorer view first.'); }
            connId = route.conn.id;

            const maxRows = vscode.workspace.getConfiguration('vscode-bigquery').get<number>('maxRows', 100000);
            let cancel: (() => void) | null = null;
            execution.token.onCancellationRequested(() => cancel?.());
            const result = await clientFor(route.conn).runQuery(queryText, maxRows, c => { cancel = c; });
            if (execution.token.isCancellationRequested) { throw new Error('Query cancelled.'); }

            const colors = sanitizedGridColorVars();
            const outputs = result.sets.map(set => vscode.NotebookCellOutputItem.json(cellPayload(result.id, set, result.elapsedMs, colors), GRID_MIME));
            await execution.replaceOutput(new vscode.NotebookCellOutput(
                outputs.length ? outputs : [vscode.NotebookCellOutputItem.text(`Completed — no result set · ${result.elapsedMs.toLocaleString()} ms`)]));

            await this.historyService?.addEntry({ query: queryText, timestamp: startTime, bytesProcessed: 0, durationMs: Date.now() - startTime, projectId: connId, status: 'success' });
            execution.end(true, Date.now());
        } catch (err: any) {
            const line = typeof err?.lineNumber === 'number' && err.lineNumber > 0 ? ` (line ${err.lineNumber})` : '';
            const message = `${err?.message ?? String(err)}${line}`;
            await execution.replaceOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.error({ name: err?.number ? `SQL error ${err.number}` : (err?.name || 'Error'), message, stack: '' }),
            ]));
            await this.historyService?.addEntry({ query: queryText, timestamp: startTime, bytesProcessed: 0, durationMs: Date.now() - startTime, projectId: connId, status: 'error', errorMessage: message });
            execution.end(false, Date.now());
        }
    }
}

/** One renderer payload per result set; the first page inline, the rest fetched on demand. */
function cellPayload(resultId: string, set: SqlResultSet, durationMs: number, colors: Record<string, string>) {
    return {
        rows: set.rows.slice(0, INITIAL_PAGE_ROWS).map(toWireRow),
        fields: set.columns.map(c => ({ name: c.name, type: c.type, mode: c.nullable ? 'NULLABLE' : 'REQUIRED' })),
        totalRows: set.rows.length,
        serverRows: set.totalRows,
        truncated: set.truncated,
        previewedRows: Math.min(set.rows.length, INITIAL_PAGE_ROWS),
        durationMs,
        rowsAffected: set.rowsAffected,
        statementType: set.rowsAffected !== undefined ? 'DML' : undefined,
        sql: { resultId, setIndex: set.index },
        colors,
    };
}
