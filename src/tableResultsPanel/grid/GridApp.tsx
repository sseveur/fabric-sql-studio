import { useCallback, useEffect, useState } from 'preact/hooks';
import { BqTable, type PageFetcher } from './BqTable';
import { handleSqlPageMessage, requestSqlPage, toWireRow } from './pagination';
import type { BqField, DmlStats, ExportRef, GridMessage } from './types';
import type { SqlResultMessage, SqlPageResponse } from '../resultContract';

interface TableView {
    key: string;
    exportRef: ExportRef;
    schema: BqField[];
    totalRows: number;
    initialRows: any[];
    source: { kind: 'sql'; resultId: string; setIndex: number };
    title?: string;
    dmlStats?: DmlStats;
    statementType?: string;
    rowsAffected?: number;
}

type View =
    | { kind: 'idle' }
    | { kind: 'loading'; message?: string }
    | { kind: 'tables'; tables: TableView[] }
    | { kind: 'error'; message: string; reason: string | null };

export function GridApp() {
    const [view, setView] = useState<View>({ kind: 'idle' });

    useEffect(() => {
        function onMessage(ev: MessageEvent) {
            const msg = ev.data as GridMessage;
            if (!msg || !msg.requestType) { return; }
            switch (msg.requestType) {
                case 'sql_page':
                    handleSqlPageMessage(msg as unknown as SqlPageResponse);
                    break;
                case 'sql_result':
                    setView(viewFromSqlResult(msg as unknown as SqlResultMessage));
                    break;
                case 'clear':
                    setView({ kind: 'idle' });
                    break;
                case 'error':
                    setView({
                        kind: 'error',
                        message: String(msg.error?.message ?? 'Unknown error'),
                        reason: (msg.error?.reason ?? null) as string | null,
                    });
                    break;
                default:
                    break;
            }
        }
        window.addEventListener('message', onMessage);
        try {
            const api = (window as any).__bqVscode;
            if (api && typeof api.postMessage === 'function') {
                api.postMessage({ command: 'load_complete' });
            }
        } catch { /* ignore */ }
        return () => window.removeEventListener('message', onMessage);
    }, []);

    if (view.kind === 'idle') { return <div class="bq-empty">No results yet.</div>; }
    if (view.kind === 'loading') { return <div class="bq-notice">{view.message || 'Loading…'}</div>; }
    if (view.kind === 'error') {
        return (
            <div class="bq-error-panel">
                <div class="bq-error-title">Query Error</div>
                <div class="bq-error-msg">{view.message}</div>
                {view.reason && <div class="bq-error-reason">Reason: {view.reason}</div>}
            </div>
        );
    }

    if (view.tables.length === 1) {
        const t = view.tables[0];
        return <BqTableHost key={t.key} view={t} />;
    }
    return (
        <div class="bq-script">
            {view.tables.map(t => (
                <div class="bq-script-item" key={t.key}>
                    <BqTableHost view={t} />
                </div>
            ))}
        </div>
    );
}

function BqTableHost({ view }: { view: TableView }) {
    const { source } = view;
    const fetchRows: PageFetcher = useCallback((start, size) =>
        requestSqlPage(source.resultId, source.setIndex, start, size)
            .then(rows => ({ rows: rows.map(toWireRow), totalRows: String(view.totalRows) })),
    [source, view.totalRows]);

    return (
        <BqTable
            fetchRows={fetchRows}
            exportRef={view.exportRef}
            schema={view.schema}
            totalRows={view.totalRows}
            initialRows={view.initialRows}
            title={view.title}
            dmlStats={view.dmlStats}
            statementType={view.statementType}
            rowsAffected={view.rowsAffected}
        />
    );
}

function viewFromSqlResult(msg: SqlResultMessage): View {
    if (!msg.sets.length) {
        return { kind: 'error', message: 'The batch returned no result sets.', reason: null };
    }
    const many = msg.sets.length > 1;
    const tables: TableView[] = msg.sets.map(set => ({
        key: `sql-${msg.resultId}-${set.index}`,
        exportRef: { sql: { resultId: msg.resultId, setIndex: set.index } },
        schema: set.columns.map((c): BqField => ({ name: c.name, type: c.type, mode: c.nullable ? 'NULLABLE' : 'REQUIRED' })),
        totalRows: set.rows.length,
        initialRows: set.rows.map(toWireRow),
        source: { kind: 'sql', resultId: msg.resultId, setIndex: set.index },
        title: many || set.truncated
            ? `${many ? `Statement ${set.index + 1}` : 'Result'}${set.truncated ? ` · showing first ${set.rows.length.toLocaleString()} of ${set.totalRows.toLocaleString()}+ rows` : ''}`
            : undefined,
        rowsAffected: set.rowsAffected,
        statementType: set.rowsAffected !== undefined ? 'DML' : undefined,
    }));
    return { kind: 'tables', tables };
}
