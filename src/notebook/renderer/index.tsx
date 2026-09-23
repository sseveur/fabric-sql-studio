import { render } from 'preact';
import { BqTable, type PageFetcher } from '../../tableResultsPanel/grid/BqTable';
import type { BqField, ExportRef } from '../../tableResultsPanel/grid/types';
// Bundled as a raw string by webpack (asset/source). Shared stylesheet with the webview grid so
// the notebook cell renders identically to the results panel.
// @ts-ignore - no module typings; webpack provides the file contents as a string.
import gridCssText from '../../../resources/grid-v2.css';

/**
 * MIME type the notebook controller tags its result output with. Keep in sync with
 * `GRID_MIME` in fsqlNotebookController.ts and the `notebookRenderer` contribution
 * in package.json.
 */
export const GRID_MIME = 'application/vnd.fabric-sql.grid+json';

/** Payload the controller emits per result set (see fsqlNotebookController.cellPayload). */
interface CellPayload {
    rows: Array<{ f: Array<{ v: any }> }>;   // positional rows wrapped as { f: [{ v }] } for the grid
    fields: BqField[];
    totalRows: number;       // rows the host holds (may exceed loaded)
    serverRows?: number;     // rows the server produced (> totalRows when truncated at maxRows)
    truncated?: boolean;
    previewedRows: number;   // rows actually loaded into this output
    durationMs: number;
    rowsAffected?: number;
    statementType?: string;
    sql?: SqlRef;            // host-held result set to page / export from
    colors?: Record<string, string>;   // sanitized { --bq-color-*: value } overrides
}

type SqlRef = { resultId: string; setIndex: number };

/** Minimal shape of the VS Code notebook renderer OutputItem (avoids a types dependency). */
interface OutputItem {
    id: string;
    mime: string;
    json(): any;
    text(): string;
}

/** Minimal shape of the renderer RendererContext when messaging is enabled. */
interface RendererContext {
    postMessage?(message: unknown): void;
    onDidReceiveMessage?(listener: (e: any) => void): { dispose(): void };
}

let stylesInjected = false;
function injectStyles(): void {
    if (stylesInjected || document.getElementById('bq-grid-v2-styles')) {
        stylesInjected = true;
        return;
    }
    // The stylesheet was written for the results-panel webview, where the grid owns the whole
    // document: it paints `body` with the editor background and sizes `.bq-root` to 100vh.
    // Injected into the shared notebook output document that blacks out the entire cell and
    // stretches it to the viewport height. Drop the global `body` rule and bound the grid to a
    // scrollable fixed height within the cell instead.
    const scoped = (gridCssText as unknown as string)
        .replace(/(^|\n)[ \t]*body[ \t]*\{[^}]*\}/g, '$1')
        // Size to content up to a cap: short results don't reserve dead space, long pages
        // scroll inside .bq-scroll (flex chain has min-height:0 + overflow:auto).
        + '\n.bq-nb-grid .bq-root { height: auto; max-height: 460px; }\n';
    const style = document.createElement('style');
    style.id = 'bq-grid-v2-styles';
    style.textContent = scoped;
    document.head.appendChild(style);
    stylesInjected = true;
}

/** Asks the extension host for a page beyond the loaded window (load-more). */
type PageRequester = (sql: SqlRef, startIndex: number, pageSize: number) => Promise<Array<{ f: Array<{ v: any }> }>>;

/** Fire-and-forget export request routed to the extension host (dialogs/fs live there). */
type ExportRequester = (command: string, sql: SqlRef) => void;

function NotebookGrid({ payload, requestPage, requestExport }: {
    payload: CellPayload;
    requestPage: PageRequester | null;
    requestExport: ExportRequester | null;
}) {
    const allRows = payload.rows || [];
    const loaded = allRows.length;
    const realTotal = payload.totalRows || loaded;
    // Only advertise more pages than are loaded when we can actually fetch them (messaging up +
    // we have a job to page against). Otherwise cap the grid to the loaded window so it never
    // offers a page it can't fill.
    const canFetchMore = !!requestPage && !!payload.sql && realTotal > loaded;
    const gridTotal = canFetchMore ? realTotal : loaded;

    const fetchRows: PageFetcher = (start, size) => {
        // Serve from the in-memory window when the page is fully covered (no round-trip).
        if (start + size <= loaded || !canFetchMore || !payload.sql) {
            return Promise.resolve({ rows: allRows.slice(start, start + size), totalRows: String(gridTotal) });
        }
        return requestPage!(payload.sql, start, size)
            .then(rows => ({ rows, totalRows: String(gridTotal) }));
    };

    const exportRef: ExportRef = payload.sql ? { sql: payload.sql } : {};
    // Grid export buttons post over renderer messaging; without messaging or a result ref there is
    // no export channel, so the buttons hide (null) rather than sit dead.
    const onExport = requestExport && payload.sql
        ? (command: string) => requestExport(command, payload.sql!)
        : null;
    const truncated = realTotal > loaded && !canFetchMore;
    const capped = payload.truncated && payload.serverRows !== undefined;
    // Per-type cell colors from the fabricSql.gridColors setting, scoped to this grid. Applied
    // via setProperty (not a style string) so CSS custom properties are set reliably.
    const applyColors = (node: HTMLElement | null) => {
        if (!node || !payload.colors) { return; }
        for (const [k, v] of Object.entries(payload.colors)) { node.style.setProperty(k, v); }
    };

    return (
        <div class="bq-nb-grid" ref={applyColors}>
            <div class="bq-nb-stats" style="opacity:.7;font-size:11px;margin:4px 2px;font-family:var(--vscode-editor-font-family,monospace);">
                {/* "0 rows" is noise on a DML result — the banner carries the affected count. */}
                {payload.rowsAffected !== undefined && realTotal === 0 ? '' : `${realTotal.toLocaleString()} rows · `}
                {payload.durationMs.toLocaleString()} ms
                {truncated ? ` · showing first ${loaded.toLocaleString()} of ${realTotal.toLocaleString()}` : ''}
                {capped ? ` · server returned ${payload.serverRows!.toLocaleString()}+ rows, kept the first ${realTotal.toLocaleString()} (maxRows)` : ''}
            </div>
            <BqTable
                fetchRows={fetchRows}
                exportRef={exportRef}
                schema={payload.fields || []}
                totalRows={gridTotal}
                initialRows={allRows}
                rowsAffected={payload.rowsAffected}
                statementType={payload.statementType}
                onExport={onExport}
            />
        </div>
    );
}

export function activate(context: RendererContext) {
    const canMessage = !!(context && typeof context.postMessage === 'function');
    const pending = new Map<string, { resolve: (rows: any[]) => void; reject: (e: Error) => void }>();
    let reqSeq = 0;

    if (canMessage && context.onDidReceiveMessage) {
        context.onDidReceiveMessage((msg: any) => {
            if (!msg || msg.type !== 'bq-page' || !msg.requestId) { return; }
            const p = pending.get(msg.requestId);
            if (!p) { return; }
            pending.delete(msg.requestId);
            if (msg.error) { p.reject(new Error(String(msg.error))); }
            else { p.resolve(msg.rows || []); }
        });
    }

    const requestPage: PageRequester | null = canMessage
        ? (sql, startIndex, pageSize) => new Promise((resolve, reject) => {
            const requestId = `bq-${++reqSeq}`;
            pending.set(requestId, { resolve, reject });
            context.postMessage!({ type: 'bq-fetch-page', requestId, sql, startIndex, pageSize });
            setTimeout(() => {
                if (pending.has(requestId)) {
                    pending.delete(requestId);
                    reject(new Error('Timed out fetching more rows.'));
                }
            }, 30000);
        })
        : null;

    // Fire-and-forget: the extension host runs the export (save dialog, clipboard)
    // and surfaces its own progress/error notifications — nothing to await here.
    const requestExport: ExportRequester | null = canMessage
        ? (command, sql) => context.postMessage!({ type: 'bq-export', command, sql })
        : null;

    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            injectStyles();
            let payload: CellPayload;
            try {
                payload = outputItem.json() as CellPayload;
            } catch (e) {
                element.textContent = `Failed to parse results: ${String(e)}`;
                return;
            }
            render(<NotebookGrid payload={payload} requestPage={requestPage} requestExport={requestExport} />, element);
        },
        disposeOutputItem(_id?: string) {
            // Preact reconciles on the next renderOutputItem call; VS Code discards the element
            // on dispose, so there is nothing to tear down explicitly.
        },
    };
}
