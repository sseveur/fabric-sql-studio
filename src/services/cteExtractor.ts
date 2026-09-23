import { parse, textAt, unquotePart } from '../language/tsqlParser';
import { extractCtesWithDependencies } from './sqlTableExtractor';

export interface CteDefinition {
    name: string;
    /** Parser range `[line, start, end]` of the CTE name. */
    range: number[];
    sourceTables: string[];
    referencedCtes: string[];
}

/** All CTE definitions of the top-level WITH statements, with their dependencies. */
export function extractCtes(sql: string): CteDefinition[] {
    return extractCtesWithDependencies(sql);
}

export interface CteColumn {
    name: string;
}

const IDENT = String.raw`(?:\[[^\]]+\]|"[^"]+"|[\w@#$]+)`;

/**
 * Column names a CTE exposes: the explicit `name (a, b) AS (...)` list when present, else the
 * aliases / trailing identifiers of its SELECT list. Regex-based so it also works while typing.
 *
 * ponytail: `SELECT *` yields `*`; expressions without an alias (COUNT(*)) are skipped. Swap in a
 * real select-list parser if that ever matters for completion.
 */
export function extractCteColumns(sql: string, cteName: string): CteColumn[] {
    const name = String.raw`(?:\[${escapeRegex(cteName)}\]|"${escapeRegex(cteName)}"|\b${escapeRegex(cteName)}\b)`;

    const explicit = new RegExp(String.raw`${name}\s*\(([^()]*)\)\s+AS\s*\(`, 'i').exec(sql);
    if (explicit) {
        return explicit[1].split(',').map(c => unquotePart(c.trim())).filter(Boolean).map(c => ({ name: c }));
    }

    const head = new RegExp(String.raw`${name}\s+AS\s*\(\s*SELECT\s+(?:DISTINCT\s+)?(?:TOP\s*\(?\s*\d+\s*\)?\s+(?:PERCENT\s+)?)?`, 'i').exec(sql);
    if (!head) { return []; }
    const selectList = extractUntilFrom(sql.substring(head.index + head[0].length));
    return selectList ? selectListColumns(selectList) : [];
}

/** Output column names of a SELECT list (the text between SELECT and FROM). */
export function selectListColumns(selectList: string): CteColumn[] {
    const columns: CteColumn[] = [];
    const push = (raw: string) => {
        const n = unquotePart(raw);
        if (n && !columns.some(c => c.name.toLowerCase() === n.toLowerCase())) { columns.push({ name: n }); }
    };
    for (const part of splitSelectColumns(selectList)) {
        const p = part.trim();
        if (!p) { continue; }
        if (p === '*' || /\.\*$/.test(p)) { push(p); continue; }
        const eq = new RegExp(String.raw`^(${IDENT})\s*=(?!=)`).exec(p);        // T-SQL `alias = expr`
        if (eq) { push(eq[1]); continue; }
        const as = new RegExp(String.raw`\bAS\s+(${IDENT})\s*$`, 'i').exec(p);
        if (as) { push(as[1]); continue; }
        const tail = new RegExp(String.raw`(${IDENT})\s*$`).exec(p);            // `t.col`, `col`, `expr alias`
        if (tail) { push(tail[1]); }
    }
    return columns;
}

/** Text up to the FROM that belongs to this SELECT (parentheses respected); null when unterminated. */
function extractUntilFrom(text: string): string | null {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') { depth++; }
        else if (ch === ')') { depth--; if (depth < 0) { return text.substring(0, i); } }
        else if (depth === 0 && /^FROM\b/i.test(text.substring(i, i + 5)) && (i === 0 || /\s/.test(text[i - 1]))) {
            return text.substring(0, i);
        }
    }
    return null;
}

function splitSelectColumns(selectList: string): string[] {
    const out: string[] = [];
    let cur = '';
    let depth = 0;
    for (const ch of selectList) {
        if (ch === '(') { depth++; }
        else if (ch === ')') { depth--; }
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else { cur += ch; }
    }
    if (cur.trim()) { out.push(cur); }
    return out;
}

/** CTE names of the top-level WITH statements; regex fallback while the statement is incomplete. */
export function getCteNames(sql: string): string[] {
    const names: string[] = [];
    for (const stmt of parse(sql).items) {
        if (stmt.item_type !== 'QueryWith') { continue; }
        for (const c of stmt.items) {
            if (c.item_type === 'TableCteId') { names.push(unquotePart(textAt(sql, c.range))); }
        }
    }
    if (names.length) { return names; }
    const re = new RegExp(String.raw`(?:\bWITH|,)\s*(${IDENT})\s*(?:\([^()]*\)\s*)?AS\s*\(`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
        const n = unquotePart(m[1]);
        if (!names.includes(n)) { names.push(n); }
    }
    return names;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Columns of the statement's main SELECT: the last SELECT outside any parentheses, i.e. what a
 * query returns or what an INSERT ... SELECT writes. An `INSERT INTO t (a, b)` column list wins.
 */
export function finalSelectColumns(sql: string): CteColumn[] {
    const insert = /\bINSERT\s+(?:INTO\s+)?(?:\[[^\]]+\]|"[^"]+"|[\w@#$.])+\s*\(([^()]*)\)/i.exec(sql);
    if (insert) {
        return insert[1].split(',').map(c => unquotePart(c.trim())).filter(Boolean).map(c => ({ name: c }));
    }
    let depth = 0, last = -1;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'" || ch === '[' || ch === '"') {
            const close = ch === '[' ? ']' : ch;
            i = sql.indexOf(close, i + 1);
            if (i < 0) { break; }
        } else if (ch === '-' && sql[i + 1] === '-') {
            i = sql.indexOf('\n', i);
            if (i < 0) { break; }
        } else if (ch === '/' && sql[i + 1] === '*') {
            i = sql.indexOf('*/', i + 2);
            if (i < 0) { break; }
            i++;
        } else if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
        } else if (depth === 0 && /^SELECT\b/i.test(sql.substring(i, i + 7)) && !/[\w@#$]/.test(sql[i - 1] ?? ' ')) {
            last = i;
        }
    }
    if (last < 0) { return []; }
    const rest = sql.substring(last).replace(/^SELECT\s+(?:DISTINCT\s+)?(?:TOP\s*\(?\s*\d+\s*\)?\s+(?:PERCENT\s+)?)?/i, '');
    const list = extractUntilFrom(rest) ?? rest.replace(/;\s*$/, '');
    return selectListColumns(list);
}
