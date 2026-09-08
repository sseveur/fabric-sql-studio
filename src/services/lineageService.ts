import { collectTableIdentifiers, parse, textAt, unquotePart } from '../language/tsqlParser';
import { extractTableReferences, normalizeTableName, tableRefOf } from './sqlTableExtractor';

export interface LineageTable {
    /** Normalised `database.schema.table`, `schema.table` or `table`. */
    fullName: string;
    database?: string;
    schema?: string;
    table: string;
    role: 'source' | 'target';
    statementType?: string;     // INSERT, CREATE TABLE, MERGE, UPDATE, DELETE, ...
    line?: number;              // 1-based, for navigation
    column?: number;
}

export interface LineageData {
    sources: LineageTable[];    // Tables read from
    targets: LineageTable[];    // Tables written to
    queryPreview: string;       // First 100 chars of query
}

export function extractLineage(sql: string): LineageData {
    const targets: LineageTable[] = [];
    const seenTargets = new Set<string>();
    for (const m of extractTargetTables(sql)) {
        const key = m.tableName.toLowerCase();
        if (seenTargets.has(key)) { continue; }
        seenTargets.add(key);
        targets.push({ ...parseTableName(m.tableName, 'target'), statementType: m.statementType, line: m.line, column: m.column });
    }

    // A target that also appears in FROM (MERGE / UPDATE ... FROM self) stays a target only.
    const sources = extractTableReferences(sql)
        .filter(ref => !seenTargets.has(ref.name.toLowerCase()))
        .map(ref => ({ ...parseTableName(ref.name, 'source'), line: ref.line, column: ref.column }));

    const preview = sql.replace(/\s+/g, ' ').trim().substring(0, 100);
    return { sources, targets, queryPreview: preview + (sql.length > 100 ? '...' : '') };
}

interface TargetMatch {
    tableName: string;
    statementType: string;
    line?: number;
    column?: number;
}

const NAME = String.raw`((?:\[[^\]]+\]|"[^"]+"|[\w@#$]+)(?:\.(?:\[[^\]]+\]|"[^"]+"|[\w@#$]+)?)*)`;
const TOP = String.raw`(?:TOP\s*\(\s*\d+\s*\)\s+)?`;

/** Written tables by statement kind. Regex over the raw text — ranges are only used for navigation. */
const TARGET_PATTERNS: Array<{ re: RegExp; type: string }> = [
    { re: new RegExp(String.raw`\bINSERT\s+${TOP}(?:INTO\s+)?${NAME}`, 'gi'), type: 'INSERT' },
    { re: new RegExp(String.raw`\bINTO\s+${NAME}\s+FROM\b`, 'gi'), type: 'SELECT INTO' },
    { re: new RegExp(String.raw`\bCREATE\s+(?:OR\s+ALTER\s+)?TABLE\s+${NAME}`, 'gi'), type: 'CREATE TABLE' },
    { re: new RegExp(String.raw`\bCREATE\s+(?:OR\s+ALTER\s+)?(?:MATERIALIZED\s+)?VIEW\s+${NAME}`, 'gi'), type: 'CREATE VIEW' },
    { re: new RegExp(String.raw`\bMERGE\s+${TOP}(?:INTO\s+)?${NAME}`, 'gi'), type: 'MERGE' },
    { re: new RegExp(String.raw`\bUPDATE\s+${TOP}${NAME}\s+(?:(?:AS\s+)?\w+\s+)?SET\b`, 'gi'), type: 'UPDATE' },
    { re: new RegExp(String.raw`\bDELETE\s+${TOP}(?:FROM\s+)?${NAME}`, 'gi'), type: 'DELETE' },
    { re: new RegExp(String.raw`\bTRUNCATE\s+TABLE\s+${NAME}`, 'gi'), type: 'TRUNCATE' },
];

function extractTargetTables(sql: string): TargetMatch[] {
    const aliases = aliasMap(sql);
    const results: TargetMatch[] = [];
    for (const { re, type } of TARGET_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(sql)) !== null) {
            const raw = m[1];
            if (!raw || raw.startsWith('@')) { continue; }
            let tableName = normalizeTableName(raw);
            // `UPDATE t SET ... FROM dbo.Orders t` / `DELETE t FROM ...` — the target is the alias.
            if (!tableName.includes('.')) { tableName = aliases.get(tableName.toLowerCase()) ?? tableName; }
            const pos = offsetToLineColumn(sql, m.index + m[0].indexOf(raw));
            results.push({ tableName, statementType: type, line: pos.line, column: pos.column });
        }
    }
    return results;
}

/** alias (lowercased) → normalised table name, over every TableIdentifier in the script. */
function aliasMap(sql: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const id of collectTableIdentifiers(parse(sql).items)) {
        const aliasItem = id.items.find(c => c.item_type === 'TableIdentifierAlias');
        const ref = tableRefOf(id, sql);
        if (aliasItem && ref && !ref.isCte) { out.set(unquotePart(textAt(sql, aliasItem.range)).toLowerCase(), ref.name); }
    }
    return out;
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
    let line = 1, column = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
        if (source[i] === '\n') { line++; column = 1; } else { column++; }
    }
    return { line, column };
}

function parseTableName(fullName: string, role: 'source' | 'target'): LineageTable {
    const parts = fullName.split('.');
    if (parts.length >= 3) { return { fullName, database: parts[parts.length - 3], schema: parts[parts.length - 2], table: parts[parts.length - 1], role }; }
    if (parts.length === 2) { return { fullName, schema: parts[0], table: parts[1], role }; }
    return { fullName, table: parts[0], role };
}
