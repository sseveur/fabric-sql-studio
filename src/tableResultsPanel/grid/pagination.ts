import type {
    JobListEntry,
    JobListResponse,
    JobReference,
    QueryResultsResponse,
    TableMetadata,
    TableReference,
} from './types';

export interface ChildJobSummary {
    jobRef: JobReference;
    statementType?: string;
    dmlStats?: { insertedRowCount?: string; updatedRowCount?: string; deletedRowCount?: string };
}

const PAGE_SIZE = 50;
const BQ_BASE = 'https://bigquery.googleapis.com/bigquery/v2';

async function bqGet<T>(url: string, token: string): Promise<T> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status}: ${text}`);
    }
    return (await res.json()) as T;
}

export async function fetchPage(
    jobRef: JobReference,
    token: string,
    startIndex: number,
    pageSize: number = PAGE_SIZE
): Promise<QueryResultsResponse> {
    const params = new URLSearchParams({
        maxResults: String(pageSize),
        startIndex: String(startIndex),
    });
    if (jobRef.location) {
        params.set('location', jobRef.location);
    }
    const url = `${BQ_BASE}/projects/${encodeURIComponent(jobRef.projectId)}/queries/${encodeURIComponent(jobRef.jobId)}?${params.toString()}`;
    return bqGet<QueryResultsResponse>(url, token);
}

export async function fetchTableMetadata(
    tableRef: TableReference,
    token: string
): Promise<TableMetadata> {
    const url = `${BQ_BASE}/projects/${encodeURIComponent(tableRef.projectId)}/datasets/${encodeURIComponent(tableRef.datasetId)}/tables/${encodeURIComponent(tableRef.tableId)}`;
    return bqGet<TableMetadata>(url, token);
}

export async function fetchTablePage(
    tableRef: TableReference,
    token: string,
    startIndex: number,
    pageSize: number = PAGE_SIZE
): Promise<QueryResultsResponse> {
    const params = new URLSearchParams({
        maxResults: String(pageSize),
        startIndex: String(startIndex),
    });
    const url = `${BQ_BASE}/projects/${encodeURIComponent(tableRef.projectId)}/datasets/${encodeURIComponent(tableRef.datasetId)}/tables/${encodeURIComponent(tableRef.tableId)}/data?${params.toString()}`;
    return bqGet<QueryResultsResponse>(url, token);
}

export async function fetchChildJobs(
    parent: JobReference,
    token: string
): Promise<ChildJobSummary[]> {
    const params = new URLSearchParams({
        parentJobId: parent.jobId,
        projection: 'full',
        maxResults: '100',
    });
    if (parent.location) {
        params.set('location', parent.location);
    }
    const url = `${BQ_BASE}/projects/${encodeURIComponent(parent.projectId)}/jobs?${params.toString()}`;
    const res = await bqGet<JobListResponse>(url, token);
    const jobs = (res.jobs || []).filter((j: JobListEntry) => {
        const t = j.statistics?.query?.statementType;
        if (!t) { return false; }
        return t === 'SELECT' || t === 'WITH' || t.startsWith('CREATE_') || t.startsWith('MERGE') || t === 'UPDATE' || t === 'INSERT' || t === 'DELETE';
    });
    return jobs.map((j: JobListEntry): ChildJobSummary => ({
        jobRef: {
            projectId: j.jobReference.projectId,
            jobId: j.jobReference.jobId,
            location: j.jobReference.location,
        },
        statementType: j.statistics?.query?.statementType,
        dmlStats: j.statistics?.query?.dmlStats,
    }));
}

export const DEFAULT_PAGE_SIZE = PAGE_SIZE;

// ---- Host-side paging for T-SQL results (see resultContract.ts) ----
import type { SqlPageRequest, SqlPageResponse } from '../resultContract';

const pending = new Map<number, { resolve: (rows: unknown[][]) => void; reject: (e: Error) => void }>();
let nextRequestId = 1;

/** Ask the extension host for a window of an in-memory result set. */
export function requestSqlPage(resultId: string, setIndex: number, startIndex: number, pageSize: number): Promise<unknown[][]> {
    const api = (window as any).__bqVscode;
    if (!api) { return Promise.reject(new Error('No host channel')); }
    const requestId = nextRequestId++;
    const msg: SqlPageRequest = { command: 'fetch_page', requestId, resultId, setIndex, startIndex, pageSize };
    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        api.postMessage(msg);
    });
}

/** Route a `sql_page` reply from the host back to its awaiting request. */
export function handleSqlPageMessage(msg: SqlPageResponse): void {
    const p = pending.get(msg.requestId);
    if (!p) { return; }
    pending.delete(msg.requestId);
    if (msg.error) { p.reject(new Error(msg.error)); } else { p.resolve(msg.rows || []); }
}

/** Positional row -> the { f: [{ v }] } shape the grid already renders. ponytail: adapter until
 *  BqTable goes positional once the BigQuery paths are deleted. */
export function toWireRow(row: unknown[]): { f: Array<{ v: unknown }> } {
    return { f: row.map(v => ({ v })) };
}
