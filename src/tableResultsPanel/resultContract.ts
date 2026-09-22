/**
 * Host <-> results-grid webview contract for T-SQL results. No vscode import: this file is
 * bundled into the webview too.
 *
 * Rows are positional (`unknown[][]`) and already JSON-safe (Date -> ISO string, Buffer -> 0x hex).
 * Paging is host-side: the webview asks for a window with `fetch_page`, the host answers with
 * `sql_page`. No token ever crosses this boundary.
 */
export interface SqlColumn {
    name: string;
    /** T-SQL declaration as reported by the driver, e.g. `nvarchar`, `bigint`, `datetime2`. */
    type: string;
    nullable: boolean;
}

export interface SqlResultSet {
    index: number;
    columns: SqlColumn[];
    /** First page of rows; more come through `fetch_page`. */
    rows: unknown[][];
    totalRows: number;
    /** Hit the `maxRows` cap — the server had more. */
    truncated: boolean;
    /** Set for statements that returned no rowset (INSERT/UPDATE/DELETE/DDL). */
    rowsAffected?: number;
}

/** host -> webview */
export interface SqlResultMessage {
    requestType: 'sql_result';
    resultId: string;
    sets: SqlResultSet[];
    elapsedMs: number;
}

export interface SqlPageResponse {
    requestType: 'sql_page';
    requestId: number;
    rows?: unknown[][];
    error?: string;
}

/** webview -> host */
export interface SqlPageRequest {
    command: 'fetch_page';
    requestId: number;
    resultId: string;
    setIndex: number;
    startIndex: number;
    pageSize: number;
}

export interface SqlClearMessage {
    requestType: 'clear';
}

export interface SqlErrorMessage {
    requestType: 'error';
    error: { message: string; reason: string | null };
}

/** Everything the host posts to the results grid. */
export type GridHostMessage = SqlResultMessage | SqlPageResponse | SqlClearMessage | SqlErrorMessage;
