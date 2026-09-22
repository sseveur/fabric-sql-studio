export interface GridError {
    message: string;
    reason: string | null;
}

export interface GridMessage {
    requestType: string;
    error?: GridError | null;
}

export interface BqField {
    name: string;
    type?: string;
    mode?: string;
    fields?: BqField[];
}

export interface ExportRef {
    /** Host-held T-SQL result set. */
    sql?: { resultId: string; setIndex: number };
}

export interface QueryResultsResponse {
    schema?: { fields: BqField[] };
    rows?: Array<{ f: Array<{ v: any }> }>;
    totalRows?: string;
    pageToken?: string;
    jobComplete?: boolean;
    totalBytesProcessed?: string;
}

export interface DmlStats {
    insertedRowCount?: string;
    updatedRowCount?: string;
    deletedRowCount?: string;
}
