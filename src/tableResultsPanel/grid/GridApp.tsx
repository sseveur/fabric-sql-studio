import { useCallback, useEffect, useState } from 'preact/hooks';
import { BqTable, type PageFetcher } from './BqTable';
import {
    DEFAULT_PAGE_SIZE,
    fetchChildJobs,
    fetchPage,
    fetchTableMetadata,
    fetchTablePage,
    handleSqlPageMessage,
    requestSqlPage,
    toWireRow,
} from './pagination';
import type {
    BqField,
    DmlStats,
    ExportRef,
    GridMessage,
    JobReference,
    TableReference,
} from './types';
import type { SqlResultMessage, SqlPageResponse } from '../resultContract';

interface TableView {
    key: string;
    exportRef: ExportRef;
    schema: BqField[];
    totalRows: number;
    initialRows: any[];
    token: string;
    source: { kind: 'job'; jobRef: JobReference } | { kind: 'table'; tableRef: TableReference } | { kind: 'sql'; resultId: string; setIndex: number };
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
                case 'execute_query':
                    setView({ kind: 'loading', message: 'Loading results…' });
                    handleExecuteQuery(msg).then(setView).catch(e => setView({ kind: 'error', message: String(e?.message || e), reason: null }));
                    break;
                case 'preview_table':
                    setView({ kind: 'loading', message: 'Loading table…' });
                    handlePreviewTable(msg).then(setView).catch(e => setView({ kind: 'error', message: String(e?.message || e), reason: null }));
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
    const { source, token } = view;
    const fetchRows: PageFetcher = useCallback((start, size) => {
        if (source.kind === 'sql') {
            return requestSqlPage(source.resultId, source.setIndex, start, size)
                .then(rows => ({ rows: rows.map(toWireRow), totalRows: String(view.totalRows) }));
        }
        if (source.kind === 'job') {
            return fetchPage(source.jobRef, token, start, size);
        }
        return fetchTablePage(source.tableRef, token, start, size);
    }, [source, token, view.totalRows]);

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
            onExport={source.kind === 'sql' ? null : undefined}
        />
    );
}

function jobRefFromJob(job: any, fallbackProjectId: string): JobReference {
    const ref = job.jobReference || job.metadata?.jobReference || {};
    return {
        projectId: String(ref.projectId || fallbackProjectId),
        jobId: String(ref.jobId || job.id),
        location: ref.location,
    };
}

async function handleExecuteQuery(msg: GridMessage): Promise<View> {
    const job = msg.job as any;
    const token = msg.token;
    const projectId = msg.projectId;
    if (!job || !token || !projectId) {
        return { kind: 'error', message: 'Missing job, token, or projectId in message payload.', reason: null };
    }
    const jobRef = jobRefFromJob(job, projectId);
    if (!jobRef.jobId) {
        return { kind: 'error', message: 'Missing jobId.', reason: null };
    }

    const hasScript =
        (job.statistics?.scriptStatistics || job.metadata?.statistics?.scriptStatistics) != null;

    if (hasScript) {
        const children = await fetchChildJobs(jobRef, String(token));
        if (children.length === 0) {
            return { kind: 'error', message: 'Script has no child jobs with results.', reason: null };
        }
        const tables: TableView[] = [];
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            try {
                const res = await fetchPage(child.jobRef, String(token), 0, DEFAULT_PAGE_SIZE);
                tables.push({
                    key: `child-${child.jobRef.jobId}`,
                    exportRef: { jobReference: child.jobRef },
                    schema: (res.schema?.fields || []) as BqField[],
                    totalRows: parseInt(String(res.totalRows || '0'), 10),
                    initialRows: res.rows || [],
                    token: String(token),
                    source: { kind: 'job', jobRef: child.jobRef },
                    title: `Statement ${i + 1}${child.statementType ? ` · ${child.statementType}` : ''}`,
                    dmlStats: child.dmlStats,
                    statementType: child.statementType,
                });
            } catch (e) {
                // skip failed child
            }
        }
        if (tables.length === 0) {
            return { kind: 'error', message: 'Script child jobs returned no results.', reason: null };
        }
        return { kind: 'tables', tables };
    }

    const res = await fetchPage(jobRef, String(token), 0, DEFAULT_PAGE_SIZE);
    const jobStats = job.statistics?.query || job.metadata?.statistics?.query || {};
    return {
        kind: 'tables',
        tables: [{
            key: `job-${jobRef.jobId}`,
            exportRef: { jobReference: jobRef },
            schema: (res.schema?.fields || []) as BqField[],
            totalRows: parseInt(String(res.totalRows || '0'), 10),
            initialRows: res.rows || [],
            dmlStats: jobStats.dmlStats,
            statementType: jobStats.statementType,
            token: String(token),
            source: { kind: 'job', jobRef },
        }],
    };
}

async function handlePreviewTable(msg: GridMessage): Promise<View> {
    const token = msg.token;
    const projectId = msg.projectId;
    const datasetId = msg.datasetId;
    const tableId = msg.tableId;
    if (!token || !projectId || !datasetId || !tableId) {
        return { kind: 'error', message: 'Missing projectId, datasetId, tableId, or token.', reason: null };
    }
    const tableRef: TableReference = { projectId, datasetId, tableId };
    const meta = await fetchTableMetadata(tableRef, String(token));
    const schema = (meta.schema?.fields || []) as BqField[];
    const totalRows = parseInt(String(meta.numRows || '0'), 10);
    const rowsRes = totalRows > 0
        ? await fetchTablePage(tableRef, String(token), 0, DEFAULT_PAGE_SIZE)
        : { rows: [] };
    return {
        kind: 'tables',
        tables: [{
            key: `table-${projectId}.${datasetId}.${tableId}`,
            exportRef: { tableReference: tableRef },
            schema,
            totalRows,
            initialRows: rowsRes.rows || [],
            token: String(token),
            source: { kind: 'table', tableRef },
            title: `${projectId}.${datasetId}.${tableId}`,
        }],
    };
}

function viewFromSqlResult(msg: SqlResultMessage): View {
    if (!msg.sets.length) {
        return { kind: 'error', message: 'The batch returned no result sets.', reason: null };
    }
    const many = msg.sets.length > 1;
    const tables: TableView[] = msg.sets.map(set => ({
        key: `sql-${msg.resultId}-${set.index}`,
        exportRef: {},
        schema: set.columns.map((c): BqField => ({ name: c.name, type: c.type, mode: c.nullable ? 'NULLABLE' : 'REQUIRED' })),
        totalRows: set.rows.length,
        initialRows: set.rows.map(toWireRow),
        token: '',
        source: { kind: 'sql', resultId: msg.resultId, setIndex: set.index },
        title: many || set.truncated
            ? `${many ? `Statement ${set.index + 1}` : 'Result'}${set.truncated ? ` · showing first ${set.rows.length.toLocaleString()} of ${set.totalRows.toLocaleString()}+ rows` : ''}`
            : undefined,
        rowsAffected: set.rowsAffected,
        statementType: set.rowsAffected !== undefined ? 'DML' : undefined,
    }));
    return { kind: 'tables', tables };
}
