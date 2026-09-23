/** Host-side paging for T-SQL results (see resultContract.ts). */
const PAGE_SIZE = 50;
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
 *  BqTable goes positional once the Fabric SQL paths are deleted. */
export function toWireRow(row: unknown[]): { f: Array<{ v: unknown }> } {
    return { f: row.map(v => ({ v })) };
}
