import { BqsqlDocumentItem } from '../language/bqsqlDocument';
import { parse, splitChain, textAt, unquotePart } from '../language/tsqlParser';

/**
 * Table references read by a query, taken from the in-house T-SQL parse tree
 * (`TableIdentifier` groups introduced by FROM / JOIN / APPLY at any nesting depth).
 */
export interface TableReference {
    /** Normalised `db.schema.table` — brackets stripped, empty parts dropped. */
    name: string;
    /** 1-based, for navigation. */
    line?: number;
    column?: number;
    /** True when the single-part name is a CTE of the same statement. */
    isCte?: boolean;
}

const SOURCE_INTROS = new Set(['FROM', 'JOIN', 'APPLY', 'USING']);

/** `[db].[s].[t]` → `db.s.t`; `db..t` → `db.t`. */
export function normalizeTableName(text: string): string {
    return splitChain(text).filter(p => p !== '').join('.');
}

export function extractTableReferences(sql: string): TableReference[] {
    const out: TableReference[] = [];
    const seen = new Set<string>();
    walkSources(parse(sql).items, sql, ref => {
        const key = ref.name.toLowerCase();
        if (!seen.has(key)) { seen.add(key); out.push(ref); }
    });
    return out;
}

/** Visits every source table (FROM/JOIN/APPLY) under `items`, recursing into sub-queries. */
export function walkSources(items: BqsqlDocumentItem[], sql: string, visit: (ref: TableReference) => void): void {
    let prevKw = '';
    for (const it of items) {
        if (it.item_type === 'TableIdentifier') {
            if (SOURCE_INTROS.has(prevKw)) {
                const ref = tableRefOf(it, sql);
                if (ref) { visit(ref); }
            }
            prevKw = '';
        } else if (it.item_type === 'Keyword') {
            prevKw = textAt(sql, it.range).toUpperCase();
        } else {
            if (it.items.length) { walkSources(it.items, sql, visit); }
            prevKw = '';
        }
    }
}

export function tableRefOf(tableIdentifier: BqsqlDocumentItem, sql: string): TableReference | null {
    const chain = tableIdentifier.items.find(c => c.item_type !== 'TableIdentifierAlias' && c.item_type !== 'Keyword');
    if (!chain) { return null; }
    const name = normalizeTableName(textAt(sql, chain.range));
    if (!name || name.startsWith('@')) { return null; }   // table variables have no catalog entry
    return { name, line: chain.range[0] + 1, column: chain.range[1] + 1, isCte: chain.item_type === 'TableCteId' };
}

export interface ExtractedCte {
    name: string;
    /** Parser range `[line, start, end]` of the CTE name. */
    range: number[];
    sourceTables: string[];
    referencedCtes: string[];
}

/** CTEs of every top-level WITH statement, with the tables and sibling CTEs each one reads. */
export function extractCtesWithDependencies(sql: string): ExtractedCte[] {
    const out: ExtractedCte[] = [];
    for (const stmt of parse(sql).items) {
        if (stmt.item_type !== 'QueryWith') { continue; }
        const cteNames = new Set(stmt.items.filter(c => c.item_type === 'TableCteId').map(c => unquotePart(textAt(sql, c.range)).toLowerCase()));
        let current: BqsqlDocumentItem | null = null;
        for (const child of stmt.items) {
            if (child.item_type === 'TableCteId') { current = child; continue; }
            if (child.item_type !== 'Query' || !current) { continue; }
            const sourceTables = new Set<string>();
            const referencedCtes = new Set<string>();
            walkSources(child.items, sql, ref => {
                if (ref.isCte || cteNames.has(ref.name.toLowerCase())) { referencedCtes.add(ref.name); } else { sourceTables.add(ref.name); }
            });
            out.push({ name: unquotePart(textAt(sql, current.range)), range: current.range, sourceTables: [...sourceTables], referencedCtes: [...referencedCtes] });
            current = null;
        }
    }
    return out;
}
