import { bracket, ConnectionRef } from './objectRef';
import { clientFor } from './sqlServerClient';
import { ResolvedTable } from './columnResolver';

export interface TopValue {
    value: unknown;
    count: number;
}

export interface ColumnProfile {
    columnName: string;
    columnType: string;
    /** Total rows in the source table. */
    totalCount: number;
    /** Number of rows where the column is NULL. */
    nullCount: number;
    /** Distinct non-null values. `null` if the type cannot be grouped (xml, geography, ...). */
    distinctCount: number | null;
    /** Distinct non-null values that occur more than once. `null` for opaque types. */
    duplicateValueCount: number | null;
    /** Total non-null rows belonging to a duplicated value. `null` for opaque types. */
    duplicateRowCount: number | null;
    /** Whether every non-null value is unique. `null` for opaque types. */
    isUnique: boolean | null;
    minValue: unknown;
    maxValue: unknown;
    /** 21 boundaries (p0, p5, …, p100) for numeric columns, else `null`. */
    quantiles: unknown[] | null;
    /** Top values by frequency (descending), else `null`. */
    topValues: TopValue[] | null;
    /** SQL that produced the profile — surfaced in the UI for debugging. */
    sourceSql: string;
}

type ProfileTier = 'numeric' | 'orderable' | 'opaque';

const NUMERIC_TYPES = new Set(['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney']);
/** Types that cannot be compared / grouped: only total and NULL counts are possible. */
const OPAQUE_TYPES = new Set(['text', 'ntext', 'image', 'xml', 'geography', 'geometry', 'hierarchyid', 'sql_variant']);

function classifyType(columnType: string): ProfileTier {
    const t = columnType.toLowerCase().replace(/\(.*$/, '');
    if (NUMERIC_TYPES.has(t)) { return 'numeric'; }
    if (OPAQUE_TYPES.has(t)) { return 'opaque'; }
    return 'orderable';
}

function fqtn(t: ResolvedTable): string {
    return `${bracket(t.database)}.${bracket(t.schema)}.${bracket(t.table)}`;
}

const TOP_K = 20;
const QUANTILE_STEPS = Array.from({ length: 21 }, (_, i) => (i * 5) / 100);

/**
 * Profile batch: result set 0 = one summary row, result set 1 = top-K values (non-opaque tiers).
 * `bit` cannot be MIN/MAX'd, so it is widened to int in the source CTE.
 */
export function buildProfileSql(t: ResolvedTable, columnName: string, columnType: string): string {
    const tier = classifyType(columnType);
    const raw = bracket(columnName);
    const col = /^bit$/i.test(columnType) ? `CAST(${raw} AS int)` : raw;
    const source = fqtn(t);

    if (tier === 'opaque') {
        return `SELECT COUNT(*) AS total_count, SUM(CASE WHEN ${raw} IS NULL THEN 1 ELSE 0 END) AS null_count FROM ${source};`;
    }

    return `WITH src AS (SELECT ${col} AS v FROM ${source}),
counts AS (SELECT v, COUNT(*) AS c FROM src WHERE v IS NOT NULL GROUP BY v)
SELECT
  (SELECT COUNT(*) FROM src) AS total_count,
  (SELECT COUNT(*) FROM src WHERE v IS NULL) AS null_count,
  (SELECT COUNT(*) FROM counts) AS distinct_count,
  (SELECT COUNT(*) FROM counts WHERE c > 1) AS duplicate_value_count,
  (SELECT ISNULL(SUM(c), 0) FROM counts WHERE c > 1) AS duplicate_row_count,
  (SELECT MIN(v) FROM src) AS min_value,
  (SELECT MAX(v) FROM src) AS max_value;
SELECT TOP ${TOP_K} v AS value, c AS count
FROM (SELECT ${col} AS v, COUNT(*) AS c FROM ${source} WHERE ${raw} IS NOT NULL GROUP BY ${col}) x
ORDER BY c DESC, v;`;
}

/** Separate statement: PERCENTILE_CONT is not available on every endpoint, so its failure is non-fatal. */
export function buildQuantileSql(t: ResolvedTable, columnName: string): string {
    const values = QUANTILE_STEPS.map(p => `(${p.toFixed(2)})`).join(',');
    return `SELECT DISTINCT q.p, PERCENTILE_CONT(q.p) WITHIN GROUP (ORDER BY CAST(s.v AS float)) OVER (PARTITION BY q.p) AS qv
FROM (SELECT ${bracket(columnName)} AS v FROM ${fqtn(t)} WHERE ${bracket(columnName)} IS NOT NULL) s
CROSS JOIN (VALUES ${values}) q(p)
ORDER BY q.p;`;
}

export async function runColumnProfileForTable(conn: ConnectionRef, table: ResolvedTable, columnName: string, columnType: string): Promise<ColumnProfile> {
    const client = clientFor(conn);
    const sql = buildProfileSql(table, columnName, columnType);
    const result = await client.runQuery(sql, TOP_K);
    const summary = result.sets[0]?.rows[0] ?? [];
    const top = result.sets[1]?.rows ?? null;

    let quantiles: unknown[] | null = null;
    if (classifyType(columnType) === 'numeric') {
        try { quantiles = (await client.query(buildQuantileSql(table, columnName))).map(r => r[1]); }
        catch { quantiles = null; }   // ponytail: endpoint without PERCENTILE_CONT → no distribution chart
    }
    return mapProfile(summary, top, quantiles, columnName, columnType, sql);
}

function mapProfile(summary: unknown[], top: unknown[][] | null, quantiles: unknown[] | null, columnName: string, columnType: string, sql: string): ColumnProfile {
    const n = (i: number) => summary[i] === undefined || summary[i] === null ? null : Number(summary[i]);
    const totalCount = n(0) ?? 0;
    const nullCount = n(1) ?? 0;
    const distinctCount = n(2);
    return {
        columnName, columnType, totalCount, nullCount, distinctCount,
        duplicateValueCount: n(3),
        duplicateRowCount: n(4),
        isUnique: distinctCount === null ? null : distinctCount === totalCount - nullCount,
        minValue: summary[5] ?? null,
        maxValue: summary[6] ?? null,
        quantiles,
        topValues: top ? top.map(r => ({ value: r[0], count: Number(r[1] ?? 0) })) : null,
        sourceSql: sql,
    };
}
