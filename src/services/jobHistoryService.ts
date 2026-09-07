import { ConnectionRef } from './objectRef';

/**
 * Server-side request history, normalised for the Job History tree.
 *
 * Fabric Warehouse / SQL analytics endpoint: `queryinsights.exec_requests_history` — every
 * completed request in the item, 30-day retention, up to ~15 min lag, full text for
 * Contributor+ roles.
 * SQL Server / Azure SQL: no history view without Query Store; we show the *live* requests
 * from `sys.dm_exec_requests` instead (own sessions only unless VIEW SERVER STATE).
 */
export interface JobHistoryEntry {
    /** Connection id + request id; `location` is unused on this backend. */
    jobReference: { projectId: string; jobId: string; location?: string };
    jobType: string;                 // 'query' | 'live'
    statementType?: string;          // SELECT / INSERT / ...
    state: 'DONE' | 'RUNNING' | 'PENDING' | 'FAILED' | 'CANCELED' | string;
    errorMessage?: string;
    user?: string;
    query?: string;
    creationTime?: number;           // epoch ms
    durationMs?: number;
    bytesProcessed?: number;         // data scanned, all tiers
    cacheHit?: boolean;
    /** Never true on TDS: a finished request's rowset cannot be re-fetched by id. */
    hasResults: boolean;
    /** Extra columns for the details panel, already display-friendly. */
    details: Array<[string, string]>;
}

export type HistorySource = 'queryinsights' | 'dmv';

export function historySourceFor(conn: ConnectionRef): HistorySource {
    return conn.kind === 'fabric' ? 'queryinsights' : 'dmv';
}

/** Page of completed requests, newest first. */
export function queryInsightsSql(onlyMine: boolean, offset: number, pageSize: number): string {
    return `SELECT distributed_statement_id, database_name, submit_time, start_time, end_time, statement_type, total_elapsed_time_ms,
    login_name, row_count, status, session_id, program_name, label, result_cache_hit, allocated_cpu_time_ms,
    data_scanned_remote_storage_mb, data_scanned_memory_mb, data_scanned_disk_mb, command, error_code, sql_pool_name
FROM queryinsights.exec_requests_history
${onlyMine ? 'WHERE login_name = USER_NAME()\n' : ''}ORDER BY submit_time DESC
OFFSET ${Math.max(0, offset)} ROWS FETCH NEXT ${Math.max(1, pageSize)} ROWS ONLY`;
}

/** Currently executing requests (no history on plain SQL Server without Query Store). */
export function liveRequestsSql(onlyMine: boolean): string {
    return `SELECT r.session_id, r.status, r.command, r.start_time, r.total_elapsed_time, s.login_name, r.row_count, r.cpu_time, r.logical_reads, t.text
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id <> @@SPID AND s.is_user_process = 1${onlyMine ? ' AND s.login_name = SUSER_SNAME()' : ''}
ORDER BY r.start_time DESC`;
}

/** Column-name → value map for one positional row. */
export function rowToRecord(columns: string[], row: unknown[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    columns.forEach((c, i) => { out[c] = row[i]; });
    return out;
}

const QI_COLUMNS = ['distributed_statement_id', 'database_name', 'submit_time', 'start_time', 'end_time', 'statement_type', 'total_elapsed_time_ms',
    'login_name', 'row_count', 'status', 'session_id', 'program_name', 'label', 'result_cache_hit', 'allocated_cpu_time_ms',
    'data_scanned_remote_storage_mb', 'data_scanned_memory_mb', 'data_scanned_disk_mb', 'command', 'error_code', 'sql_pool_name'];
const DMV_COLUMNS = ['session_id', 'status', 'command', 'start_time', 'total_elapsed_time', 'login_name', 'row_count', 'cpu_time', 'logical_reads', 'text'];

export function describeQueryInsightsRow(connId: string, row: unknown[]): JobHistoryEntry {
    const r = rowToRecord(QI_COLUMNS, row);
    const status = String(r.status ?? '').toLowerCase();
    const state = status === 'succeeded' ? 'DONE' : status === 'failed' ? 'FAILED' : status === 'canceled' ? 'CANCELED' : String(r.status ?? 'UNKNOWN').toUpperCase();
    const scannedMb = num(r.data_scanned_remote_storage_mb) + num(r.data_scanned_memory_mb) + num(r.data_scanned_disk_mb);
    const errorCode = num(r.error_code);
    return {
        jobReference: { projectId: connId, jobId: String(r.distributed_statement_id ?? '') },
        jobType: 'query',
        statementType: str(r.statement_type),
        state,
        errorMessage: state === 'FAILED' ? `error ${errorCode || ''}`.trim() : undefined,
        user: str(r.login_name),
        query: str(r.command),
        creationTime: ms(r.submit_time ?? r.start_time),
        durationMs: num(r.total_elapsed_time_ms) || undefined,
        bytesProcessed: scannedMb > 0 ? Math.round(scannedMb * 1024 * 1024) : undefined,
        cacheHit: num(r.result_cache_hit) === 2,
        hasResults: false,
        details: [
            ['Statement id', String(r.distributed_statement_id ?? '')],
            ['Database', str(r.database_name) ?? ''],
            ['Status', String(r.status ?? '')],
            ['Submitted', iso(r.submit_time)],
            ['Started', iso(r.start_time)],
            ['Ended', iso(r.end_time)],
            ['Elapsed', `${(num(r.total_elapsed_time_ms) / 1000).toFixed(2)} s`],
            ['CPU allocated', `${(num(r.allocated_cpu_time_ms) / 1000).toFixed(2)} s`],
            ['Rows', String(num(r.row_count))],
            ['Scanned remote (OneLake)', `${num(r.data_scanned_remote_storage_mb).toFixed(1)} MB`],
            ['Scanned memory', `${num(r.data_scanned_memory_mb).toFixed(1)} MB`],
            ['Scanned disk', `${num(r.data_scanned_disk_mb).toFixed(1)} MB`],
            ['Result cache', num(r.result_cache_hit) === 2 ? 'hit' : num(r.result_cache_hit) === 1 ? 'created' : 'n/a'],
            ['SQL pool', str(r.sql_pool_name) ?? '—'],
            ['Session', String(r.session_id ?? '')],
            ['Program', str(r.program_name) ?? '—'],
            ['Label', str(r.label) ?? '—'],
            ['Error code', errorCode ? String(errorCode) : '—'],
        ],
    };
}

export function describeLiveRequestRow(connId: string, row: unknown[]): JobHistoryEntry {
    const r = rowToRecord(DMV_COLUMNS, row);
    const status = String(r.status ?? '').toLowerCase();
    return {
        jobReference: { projectId: connId, jobId: `session ${r.session_id}` },
        jobType: 'live',
        statementType: str(r.command),
        state: status === 'running' ? 'RUNNING' : status === 'suspended' || status === 'runnable' ? 'PENDING' : status.toUpperCase(),
        user: str(r.login_name),
        query: str(r.text),
        creationTime: ms(r.start_time),
        durationMs: num(r.total_elapsed_time) || undefined,
        hasResults: false,
        details: [
            ['Session', String(r.session_id ?? '')],
            ['Status', String(r.status ?? '')],
            ['Command', str(r.command) ?? ''],
            ['Started', iso(r.start_time)],
            ['Elapsed', `${(num(r.total_elapsed_time) / 1000).toFixed(2)} s`],
            ['CPU', `${(num(r.cpu_time) / 1000).toFixed(2)} s`],
            ['Logical reads', String(num(r.logical_reads))],
            ['Rows so far', String(num(r.row_count))],
        ],
    };
}

/** One-line label for the tree: query preview, or type + statement. */
export function jobEntryLabel(e: JobHistoryEntry, maxLen = 60): string {
    if (e.query) {
        const flat = e.query.replace(/\s+/g, ' ').trim();
        return flat.length > maxLen ? flat.slice(0, maxLen - 1) + '…' : flat;
    }
    return [e.jobType, e.statementType].filter(Boolean).join(' · ') || e.jobReference.jobId;
}

/** Short description: statement + user + size + duration + age. */
export function jobEntryDescription(e: JobHistoryEntry, now = Date.now()): string {
    const parts: string[] = [];
    if (e.statementType) { parts.push(e.statementType); }
    else if (e.jobType && e.jobType !== 'query') { parts.push(e.jobType.toUpperCase()); }
    if (e.user) { parts.push(e.user.split('@')[0]); }
    if (e.cacheHit) { parts.push('cached'); }
    else if (e.bytesProcessed) { parts.push(formatJobBytes(e.bytesProcessed)); }
    if (e.durationMs !== undefined) { parts.push(`${(e.durationMs / 1000).toFixed(1)}s`); }
    if (e.creationTime) { parts.push(relativeAge(e.creationTime, now)); }
    return parts.join(' · ');
}

export function formatJobBytes(bytes: number): string {
    if (!bytes || bytes <= 0) { return '0 B'; }
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function relativeAge(thenMs: number, now = Date.now()): string {
    const s = Math.max(0, Math.round((now - thenMs) / 1000));
    if (s < 60) { return `${s}s ago`; }
    const m = Math.round(s / 60);
    if (m < 60) { return `${m}m ago`; }
    const h = Math.round(m / 60);
    if (h < 24) { return `${h}h ago`; }
    return `${Math.round(h / 24)}d ago`;
}

function num(v: unknown): number {
    if (v === null || v === undefined || v === '') { return 0; }
    const n = Number(v);
    return isFinite(n) ? n : 0;
}
function str(v: unknown): string | undefined {
    return v === null || v === undefined ? undefined : String(v);
}
function ms(v: unknown): number | undefined {
    if (!v) { return undefined; }
    const t = new Date(String(v)).getTime();
    return isFinite(t) ? t : undefined;
}
function iso(v: unknown): string {
    const t = ms(v);
    return t ? new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '—';
}
