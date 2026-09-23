import { FsqlDocumentItem } from '../language/fsqlDocument';
import { collectTableIdentifiers, lineOffsets, parse, splitChain, textAt, Tok, tokenize, unquotePart } from '../language/tsqlParser';
import { bracket } from './objectRef';
import { connectionForDatabase } from './queryRouter';
import { clientFor } from './sqlServerClient';

export interface ResolvedTable {
    database: string;
    schema: string;
    table: string;
}

export interface ResolvedColumn extends ResolvedTable {
    columnName: string;
    /** T-SQL data type (int, nvarchar, ...). */
    columnType: string;
}

export type ColumnLookup = (table: ResolvedTable) => Promise<Array<{ name: string; type: string }>>;

interface TableInScope extends ResolvedTable {
    /** Alias if present, otherwise the table's short name. */
    alias: string;
}

/** INFORMATION_SCHEMA.COLUMNS over whichever connection knows the database. */
export const defaultColumnLookup: ColumnLookup = async (t) => {
    const conn = await connectionForDatabase(t.database);
    if (!conn) { throw new Error(`No connection profile knows database "${t.database}".`); }
    const rows = await clientFor(conn).query(
        `SELECT COLUMN_NAME, DATA_TYPE FROM ${bracket(t.database)}.INFORMATION_SCHEMA.COLUMNS ` +
        `WHERE TABLE_SCHEMA = N'${t.schema.replace(/'/g, "''")}' AND TABLE_NAME = N'${t.table.replace(/'/g, "''")}' ORDER BY ORDINAL_POSITION`);
    return rows.map(r => ({ name: String(r[0]), type: String(r[1]) }));
};

/**
 * Resolves the column at the cursor to (database, schema, table, column, type) using the tables
 * of the surrounding statement: `alias.col` looks the alias up; a bare `col` is searched in every
 * table in scope and must be unambiguous. Returns null when the cursor is not on an identifier.
 */
export async function resolveColumnAtPosition(sql: string, offset: number, defaultDatabase: string | undefined, lookup: ColumnLookup = defaultColumnLookup): Promise<ResolvedColumn | null> {
    const chain = chainAt(sql, offset);
    if (!chain) { return null; }
    const column = chain[chain.length - 1];
    const alias = chain.length >= 2 ? chain[chain.length - 2] : undefined;

    const tables = tablesInScope(sql, offset, defaultDatabase);
    if (tables.length === 0) { throw new Error('No source tables found in the surrounding statement — cannot resolve the column.'); }

    const find = (cols: Array<{ name: string; type: string }>) => cols.find(c => c.name.toLowerCase() === column.toLowerCase());

    if (alias) {
        const target = tables.find(t => t.alias.toLowerCase() === alias.toLowerCase() || t.table.toLowerCase() === alias.toLowerCase());
        if (!target) { throw new Error(`Could not find a table or alias named "${alias}" in the surrounding statement.`); }
        const col = find(await lookup(target));
        if (!col) { throw new Error(`Column "${column}" not found in ${target.database}.${target.schema}.${target.table}.`); }
        return { ...plain(target), columnName: col.name, columnType: col.type };
    }

    const matches: ResolvedColumn[] = [];
    for (const t of tables) {
        try {
            const col = find(await lookup(t));
            if (col) { matches.push({ database: t.database, schema: t.schema, table: t.table, columnName: col.name, columnType: col.type }); }
        } catch { /* unreachable table — skip */ }
    }
    if (matches.length === 0) { throw new Error(`Column "${column}" not found in any source table of the surrounding statement.`); }
    if (matches.length > 1) {
        throw new Error(`Column "${column}" is ambiguous — present in: ${matches.map(m => `${m.schema}.${m.table}`).join(', ')}. Qualify it with an alias.`);
    }
    return matches[0];
}

/**
 * Resolves the table reference at the cursor: `db.schema.table` as written, `schema.table` with
 * the default database, or a bare name / alias matched against the surrounding statement's
 * FROM/JOIN tables. Returns null when the cursor is not on an identifier.
 */
export function resolveTableAtPosition(sql: string, offset: number, defaultDatabase: string | undefined): ResolvedTable | null {
    const parts = chainAt(sql, offset);
    if (!parts) { return null; }
    if (parts.length >= 3) { return toTable(parts, defaultDatabase); }

    const tables = tablesInScope(sql, offset, defaultDatabase);
    if (parts.length === 2) {
        const [schema, table] = parts;
        const byAlias = tables.find(t => t.alias.toLowerCase() === schema.toLowerCase());   // cursor on `alias.column`
        if (byAlias) { return plain(byAlias); }
        const hit = tables.find(t => t.schema.toLowerCase() === schema.toLowerCase() && t.table.toLowerCase() === table.toLowerCase());
        return hit ? plain(hit) : toTable(parts, defaultDatabase);
    }
    const word = parts[0].toLowerCase();
    const hit = tables.find(t => t.table.toLowerCase() === word || t.alias.toLowerCase() === word);
    return hit ? plain(hit) : null;
}

function plain(t: TableInScope): ResolvedTable {
    return { database: t.database, schema: t.schema, table: t.table };
}

/** Dotted identifier chain under the cursor, unquoted, e.g. `[db].[s].t` → ['db','s','t']. */
export function chainAt(sql: string, offset: number): string[] | null {
    const offs = lineOffsets(sql);
    const toks = tokenize(sql).filter(t => t.kind !== 'comment');
    const abs = (t: Tok) => offs[t.line] + t.start;
    const idx = toks.findIndex(t => (t.kind === 'ident' || t.kind === 'keyword') && abs(t) <= offset && offset <= abs(t) + (t.end - t.start));
    if (idx < 0 || toks[idx].kind === 'keyword') { return null; }

    const isDot = (t: Tok | undefined) => !!t && t.kind === 'punct' && t.text === '.';
    let lo = idx, hi = idx;
    while (isDot(toks[lo - 1]) && toks[lo - 2]?.kind === 'ident') { lo -= 2; }
    while (isDot(toks[hi + 1]) && toks[hi + 2]?.kind === 'ident') { hi += 2; }
    return toks.slice(lo, hi + 1).filter(t => t.kind === 'ident').map(t => unquotePart(t.text));
}

/**
 * CTE named or aliased at the cursor (`FROM ranked r` → cursor on `ranked` or `r` gives `ranked`),
 * for the statement around the cursor. Null when the identifier is not a CTE.
 */
export function resolveCteAtPosition(sql: string, offset: number): string | null {
    const parts = chainAt(sql, offset);
    if (!parts || parts.length !== 1) { return null; }
    const word = parts[0].toLowerCase();
    for (const id of identifiersInScope(sql, offset)) {
        const chain = id.items.find(c => c.item_type === 'TableCteId');
        if (!chain) { continue; }
        const name = unquotePart(textAt(sql, chain.range));
        const aliasItem = id.items.find(c => c.item_type === 'TableIdentifierAlias');
        const alias = aliasItem ? unquotePart(textAt(sql, aliasItem.range)) : name;
        if (name.toLowerCase() === word || alias.toLowerCase() === word) { return name; }
    }
    return null;
}

/** TableIdentifier nodes of the top-level statement containing the cursor (whole document as fallback). */
function identifiersInScope(sql: string, offset: number): FsqlDocumentItem[] {
    const doc = parse(sql);
    const line = lineOffsets(sql).filter(o => o <= offset).length - 1;
    const stmt = doc.items.find(it => { const ls = leafLines(it); return ls.length > 0 && Math.min(...ls) <= line && line <= Math.max(...ls); });
    return collectTableIdentifiers(stmt ? [stmt] : doc.items);
}

function tablesInScope(sql: string, offset: number, defaultDatabase: string | undefined): TableInScope[] {
    const out: TableInScope[] = [];
    for (const id of identifiersInScope(sql, offset)) {
        const chain = id.items.find(c => c.item_type.startsWith('TableIdentifier') && c.item_type !== 'TableIdentifierAlias');
        if (!chain) { continue; }                                   // CTE reference — no catalog columns
        const table = toTable(splitChain(textAt(sql, chain.range)), defaultDatabase);
        if (!table) { continue; }
        const aliasItem = id.items.find(c => c.item_type === 'TableIdentifierAlias');
        const alias = aliasItem ? unquotePart(textAt(sql, aliasItem.range)) : table.table;
        if (!out.some(t => t.alias.toLowerCase() === alias.toLowerCase() && t.table.toLowerCase() === table.table.toLowerCase())) { out.push({ ...table, alias }); }
    }
    return out;
}

/** `t` → [default db, dbo, t]; `s.t` → [default db, s, t]; `d.s.t` / `d..t` / `srv.d.s.t` → last three. */
function toTable(parts: string[], defaultDatabase: string | undefined): ResolvedTable | null {
    const p = parts.filter((x, i, arr) => x !== '' || i === arr.length - 2);
    const table = p[p.length - 1];
    if (!table || table.startsWith('@')) { return null; }
    const database = p.length >= 3 ? p[p.length - 3] : defaultDatabase;
    const schema = p.length >= 2 && p[p.length - 2] ? p[p.length - 2] : 'dbo';
    return database ? { database, schema, table } : null;
}

function leafLines(item: FsqlDocumentItem, out: number[] = []): number[] {
    if (item.range.length >= 3) { out.push(item.range[0]); }
    for (const c of item.items) { leafLines(c, out); }
    return out;
}
