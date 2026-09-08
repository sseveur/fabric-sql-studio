import { BqsqlDocument, BqsqlDocumentItem } from './bqsqlDocument';
import { BqsqlSuggestion } from './bqsqlSuggestion';

/**
 * T-SQL tokenizer + light structure builder that emits the same `{ item_type, range, items }`
 * tree the old BigQuery WASM parser produced, so the completion / hover / semantic-token /
 * folding providers and the CTE extractor keep working unchanged.
 *
 * Ranges are per line: `[line, startChar, endChar]`. Statement nodes carry no range of their
 * own (consumers derive it from the leaves). Only the shapes those consumers read are modelled:
 * keywords, literals, operators, punctuation, `TableIdentifier` groups after FROM/JOIN/INTO/
 * UPDATE/DELETE/MERGE/APPLY/TABLE, `QueryWith` blocks with `TableCteId` names, and nested
 * `Query` nodes for parenthesised sub-selects. No T-SQL library gives a CST with offsets, hence
 * the hand-rolled scanner (see plan M5).
 */

export const KEYWORDS = new Set<string>([
    'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'APPLY', 'AS', 'ASC', 'AUTHORIZATION', 'BACKUP', 'BEGIN', 'BETWEEN', 'BREAK', 'BROWSE', 'BULK', 'BY',
    'CASCADE', 'CASE', 'CATCH', 'CHECK', 'CHECKPOINT', 'CLOSE', 'CLUSTERED', 'COLLATE', 'COLUMN', 'COMMIT', 'CONSTRAINT', 'CONTAINS', 'CONTINUE',
    'CREATE', 'CROSS', 'CURRENT', 'CURSOR', 'DATABASE', 'DEALLOCATE', 'DECLARE', 'DEFAULT', 'DELETE', 'DENY', 'DESC', 'DISTINCT', 'DISTRIBUTED',
    'DROP', 'ELSE', 'END', 'ESCAPE', 'EXCEPT', 'EXEC', 'EXECUTE', 'EXISTS', 'EXIT', 'EXTERNAL', 'FETCH', 'FILE', 'FIRST', 'FOLLOWING', 'FOR',
    'FOREIGN', 'FROM', 'FULL', 'FUNCTION', 'GO', 'GOTO', 'GRANT', 'GROUP', 'HAVING', 'HOLDLOCK', 'IDENTITY', 'IF', 'IN', 'INDEX', 'INNER',
    'INSERT', 'INTERSECT', 'INTO', 'IS', 'JOIN', 'KEY', 'LAST', 'LEFT', 'LIKE', 'MATCHED', 'MERGE', 'NEXT', 'NOCHECK', 'NONCLUSTERED',
    'NOLOCK', 'NOT', 'NULL', 'NULLS', 'OF', 'OFF', 'OFFSET', 'ON', 'ONLY', 'OPEN', 'OPTION', 'OR', 'ORDER', 'OUTER', 'OUTPUT', 'OVER',
    'PARTITION', 'PERCENT', 'PIVOT', 'PRECEDING', 'PRIMARY', 'PRINT', 'PROC', 'PROCEDURE', 'RAISERROR', 'RANGE', 'READ', 'RECURSIVE',
    'REFERENCES', 'REPLICATION', 'RESTORE', 'RETURN', 'RETURNS', 'REVOKE', 'RIGHT', 'ROLLBACK', 'ROW', 'ROWS', 'SAVE', 'SCHEMA', 'SELECT',
    'SET', 'SOME', 'TABLE', 'TABLESAMPLE', 'TARGET', 'SOURCE', 'THEN', 'THROW', 'TIES', 'TO', 'TOP', 'TRAN', 'TRANSACTION', 'TRIGGER',
    'TRUNCATE', 'TRY', 'UNBOUNDED', 'UNION', 'UNIQUE', 'UNPIVOT', 'UPDATE', 'USE', 'USING', 'VALUES', 'VIEW', 'WAITFOR', 'WHEN', 'WHERE',
    'WHILE', 'WITH', 'WITHIN', 'XML', 'PATH', 'ROOT', 'AUTO', 'ELEMENTS', 'JSON', 'INCLUDE', 'INCLUDE_NULL_VALUES', 'WITHOUT_ARRAY_WRAPPER',
    'COPY', 'INTO', 'FILE_FORMAT', 'OPENROWSET', 'OPENJSON', 'STRING_SPLIT', 'CROSS APPLY', 'OUTER APPLY',
]);

/** Keywords that open a new top-level statement when seen at parenthesis depth 0. */
const STATEMENT_START = new Set<string>([
    'SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'DECLARE', 'SET', 'EXEC', 'EXECUTE',
    'IF', 'BEGIN', 'WHILE', 'PRINT', 'USE', 'GRANT', 'REVOKE', 'DENY', 'RETURN', 'THROW', 'RAISERROR', 'COMMIT', 'ROLLBACK', 'COPY',
]);

/** After these, an identifier chain names a table (or CTE). */
const TABLE_INTRO = new Set<string>(['FROM', 'JOIN', 'INTO', 'UPDATE', 'APPLY', 'TABLE', 'DELETE', 'MERGE', 'USING']);

/** A statement whose head is one of these may legitimately contain another statement-start keyword. */
const NESTING_HEADS = new Set<string>(['WITH', 'INSERT', 'UPDATE', 'IF', 'WHILE', 'BEGIN', 'CREATE', 'ALTER', 'MERGE', 'DECLARE', 'SET']);

export interface Tok {
    kind: 'ident' | 'keyword' | 'number' | 'string' | 'operator' | 'punct' | 'comment';
    text: string;
    line: number;
    start: number;
    end: number;
}

// ---------------------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------------------

export function tokenize(sql: string): Tok[] {
    const toks: Tok[] = [];
    const lines = sql.split('\n');
    let inBlockComment = false;

    for (let line = 0; line < lines.length; line++) {
        const text = lines[line].replace(/\r$/, '');
        let i = 0;
        const n = text.length;

        while (i < n) {
            if (inBlockComment) {
                const close = text.indexOf('*/', i);
                if (close < 0) { i = n; break; }
                inBlockComment = false;
                i = close + 2;
                continue;
            }
            const ch = text[i];
            if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

            if (ch === '-' && text[i + 1] === '-') {
                toks.push({ kind: 'comment', text: text.slice(i), line, start: i, end: n });
                break;
            }
            if (ch === '/' && text[i + 1] === '*') {
                const close = text.indexOf('*/', i + 2);
                if (close < 0) { inBlockComment = true; i = n; } else { i = close + 2; }
                continue;
            }

            // strings: '...' with '' escape; N'...' prefix
            if (ch === "'" || ((ch === 'N' || ch === 'n') && text[i + 1] === "'")) {
                const start = i;
                i += ch === "'" ? 1 : 2;
                while (i < n) {
                    if (text[i] === "'") {
                        if (text[i + 1] === "'") { i += 2; continue; }
                        i++; break;
                    }
                    i++;
                }
                toks.push({ kind: 'string', text: text.slice(start, i), line, start, end: i });
                continue;
            }
            // bracket identifier
            if (ch === '[') {
                const start = i; i++;
                while (i < n) {
                    if (text[i] === ']') { if (text[i + 1] === ']') { i += 2; continue; } i++; break; }
                    i++;
                }
                toks.push({ kind: 'ident', text: text.slice(start, i), line, start, end: i });
                continue;
            }
            // quoted identifier
            if (ch === '"') {
                const start = i; i++;
                while (i < n && text[i] !== '"') { i++; }
                i = Math.min(i + 1, n);
                toks.push({ kind: 'ident', text: text.slice(start, i), line, start, end: i });
                continue;
            }
            // number
            if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
                const m = /^(?:0x[0-9a-fA-F]+|\d*\.?\d+(?:[eE][+-]?\d+)?|\d+\.)/.exec(text.slice(i));
                const len = m ? m[0].length : 1;
                toks.push({ kind: 'number', text: text.slice(i, i + len), line, start: i, end: i + len });
                i += len;
                continue;
            }
            // identifier / keyword / @variable / #temp
            if (/[A-Za-z_@#]/.test(ch)) {
                const m = /^[A-Za-z_@#][\w@#$]*/.exec(text.slice(i))!;
                const word = m[0];
                const isKw = !/^[@#]/.test(word) && KEYWORDS.has(word.toUpperCase());
                toks.push({ kind: isKw ? 'keyword' : 'ident', text: word, line, start: i, end: i + word.length });
                i += word.length;
                continue;
            }
            // punctuation
            if ('(),;.'.includes(ch)) {
                toks.push({ kind: 'punct', text: ch, line, start: i, end: i + 1 });
                i++;
                continue;
            }
            // operators
            const op = /^(<=|>=|<>|!=|!<|!>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|::|[+\-*\/%=<>&|^~])/.exec(text.slice(i));
            if (op) {
                toks.push({ kind: 'operator', text: op[0], line, start: i, end: i + op[0].length });
                i += op[0].length;
                continue;
            }
            i++; // unknown char — skip
        }
    }
    return toks;
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

function leaf(t: Tok): BqsqlDocumentItem {
    let type: string;
    switch (t.kind) {
        case 'keyword': type = 'Keyword'; break;
        case 'number': type = 'Number'; break;
        case 'string': type = 'String'; break;
        case 'operator': type = 'Operator'; break;
        case 'comment': type = 'LineComment'; break;
        case 'punct':
            type = t.text === '(' ? 'ParenthesesOpen' : t.text === ')' ? 'ParenthesesClose'
                : t.text === ',' ? 'Comma' : t.text === ';' ? 'Semicolon' : 'Dot';
            break;
        default: type = 'Unknown';
    }
    return { item_type: type, range: [t.line, t.start, t.end], items: [] };
}

function node(type: string, items: BqsqlDocumentItem[]): BqsqlDocumentItem {
    return { item_type: type, range: [], items };
}

export function isKw(t: Tok | undefined, word: string): boolean {
    return !!t && t.kind === 'keyword' && t.text.toUpperCase() === word;
}

/** Index of the `)` closing the `(` at `open`; the last token index when unbalanced. */
export function matchingParen(toks: Tok[], open: number): number {
    let depth = 0;
    for (let i = open; i < toks.length; i++) {
        if (toks[i].kind !== 'punct') { continue; }
        if (toks[i].text === '(') { depth++; }
        else if (toks[i].text === ')') { depth--; if (depth === 0) { return i; } }
    }
    return toks.length - 1;
}

/** Strips [ ], " " and doubled ]] from one identifier part. */
export function unquotePart(part: string): string {
    if (part.startsWith('[') && part.endsWith(']')) { return part.slice(1, -1).replace(/]]/g, ']'); }
    if (part.startsWith('"') && part.endsWith('"')) { return part.slice(1, -1); }
    return part;
}

/** `[db].[s].[t]` / `db..t` → parts, unquoted, empty parts kept. */
export function splitChain(text: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let inBracket = false, inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inBracket) { cur += ch; if (ch === ']') { if (text[i + 1] === ']') { cur += ']'; i++; } else { inBracket = false; } } continue; }
        if (inQuote) { cur += ch; if (ch === '"') { inQuote = false; } continue; }
        if (ch === '[') { inBracket = true; cur += ch; continue; }
        if (ch === '"') { inQuote = true; cur += ch; continue; }
        if (ch === '.') { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    parts.push(cur);
    return parts.map(unquotePart);
}

/**
 * Consume `ident(.ident)*` starting at `i`. Returns the item and the next index, or null when the
 * token at `i` cannot start a table name.
 */
function readTableIdentifier(toks: Tok[], i: number, cteNames: Set<string>): { item: BqsqlDocumentItem; next: number } | null {
    const first = toks[i];
    if (!first || first.kind !== 'ident') { return null; }

    let j = i;
    let last = first;
    let parts = 1;
    while (toks[j + 1] && toks[j + 1].kind === 'punct' && toks[j + 1].text === '.') {
        const after = toks[j + 2];
        if (after && after.kind === 'ident' && after.line === first.line) { last = after; j += 2; parts++; }
        else if (after && after.kind === 'punct' && after.text === '.' && toks[j + 3]?.kind === 'ident' && toks[j + 3].line === first.line) {
            // db..table
            last = toks[j + 3]; j += 3; parts += 2;
        } else { break; }
    }

    const chainRange = last.line === first.line ? [first.line, first.start, last.end] : [first.line, first.start, first.end];
    const chainText = toks.slice(i, j + 1).map(t => t.text).join('');
    const name = splitChain(chainText).pop() ?? '';
    let type: string;
    if (parts === 1) { type = cteNames.has(name.toLowerCase()) ? 'TableCteId' : 'TableIdentifierTableId'; }
    else if (parts === 2) { type = 'TableIdentifierDatasetIdTableId'; }
    else { type = 'TableIdentifierProjectIdDatasetIdTableId'; }

    const children: BqsqlDocumentItem[] = [{ item_type: type, range: chainRange, items: [] }];
    let next = j + 1;

    // alias: `t AS a` or `t a` (not a keyword, not punctuation)
    if (isKw(toks[next], 'AS') && toks[next + 1]?.kind === 'ident') {
        children.push(leaf(toks[next]));
        children.push({ item_type: 'TableIdentifierAlias', range: [toks[next + 1].line, toks[next + 1].start, toks[next + 1].end], items: [] });
        next += 2;
    } else if (toks[next]?.kind === 'ident') {
        children.push({ item_type: 'TableIdentifierAlias', range: [toks[next].line, toks[next].start, toks[next].end], items: [] });
        next += 1;
    }
    return { item: node('TableIdentifier', children), next };
}

function buildItems(toks: Tok[], cteNames: Set<string>): BqsqlDocumentItem[] {
    const items: BqsqlDocumentItem[] = [];
    let i = 0;
    while (i < toks.length) {
        const t = toks[i];

        if (t.kind === 'punct' && t.text === '(') {
            const close = matchingParen(toks, i);
            const inner = toks.slice(i + 1, close);
            items.push(leaf(t));
            if (isKw(inner[0], 'SELECT') || isKw(inner[0], 'WITH')) {
                items.push(node('Query', buildItems(inner, cteNames)));
            } else {
                items.push(...buildItems(inner, cteNames));
            }
            if (close < toks.length) { items.push(leaf(toks[close])); }
            i = close + 1;
            continue;
        }

        if (t.kind === 'keyword' && TABLE_INTRO.has(t.text.toUpperCase())) {
            items.push(leaf(t));
            let k = i + 1;
            // DELETE FROM x / MERGE INTO x / INSERT INTO x — let the inner keyword introduce the table.
            if (isKw(toks[k], 'FROM') || isKw(toks[k], 'INTO')) { i = k; continue; }
            // CREATE TABLE only when the previous keyword was CREATE/ALTER/DROP/TRUNCATE
            if (t.text.toUpperCase() === 'TABLE') {
                const prev = toks[i - 1];
                if (!prev || prev.kind !== 'keyword' || !['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'INTO'].includes(prev.text.toUpperCase())) { i++; continue; }
            }
            const ti = readTableIdentifier(toks, k, cteNames);
            if (ti) { items.push(ti.item); i = ti.next; continue; }
            i++;
            continue;
        }

        items.push(leaf(t));
        i++;
    }
    return items;
}

/** Names introduced by `WITH a AS (...), b (cols) AS (...)` at depth 0 of one statement. */
function collectCteNames(toks: Tok[]): Set<string> {
    const names = new Set<string>();
    if (!isKw(toks[0], 'WITH')) { return names; }
    let i = 1;
    if (isKw(toks[i], 'RECURSIVE')) { i++; }
    while (i < toks.length) {
        const t = toks[i];
        if (t.kind !== 'ident') { break; }
        names.add(unquotePart(t.text).toLowerCase());
        i++;
        if (toks[i]?.kind === 'punct' && toks[i].text === '(') { i = matchingParen(toks, i) + 1; }
        if (!isKw(toks[i], 'AS')) { break; }
        i++;
        if (toks[i]?.kind === 'punct' && toks[i].text === '(') { i = matchingParen(toks, i) + 1; } else { break; }
        if (toks[i]?.kind === 'punct' && toks[i].text === ',') { i++; } else { break; }
    }
    return names;
}

function buildWith(toks: Tok[], cteNames: Set<string>): BqsqlDocumentItem {
    const items: BqsqlDocumentItem[] = [leaf(toks[0])];
    let i = 1;
    if (isKw(toks[i], 'RECURSIVE')) { items.push(leaf(toks[i])); i++; }
    while (i < toks.length) {
        const t = toks[i];
        if (t.kind !== 'ident') { break; }
        items.push({ item_type: 'TableCteId', range: [t.line, t.start, t.end], items: [] });
        i++;
        if (toks[i]?.kind === 'punct' && toks[i].text === '(') {           // column list
            const close = matchingParen(toks, i);
            items.push(...toks.slice(i, close + 1).map(leaf));
            i = close + 1;
        }
        if (!isKw(toks[i], 'AS')) { break; }
        items.push(leaf(toks[i])); i++;
        if (!(toks[i]?.kind === 'punct' && toks[i].text === '(')) { break; }
        const close = matchingParen(toks, i);
        items.push(leaf(toks[i]));
        items.push(node('Query', buildItems(toks.slice(i + 1, close), cteNames)));
        if (close < toks.length) { items.push(leaf(toks[close])); }
        i = close + 1;
        if (toks[i]?.kind === 'punct' && toks[i].text === ',') { items.push(leaf(toks[i])); i++; continue; }
        break;
    }
    items.push(...buildItems(toks.slice(i), cteNames));
    return node('QueryWith', items);
}

function statementType(toks: Tok[]): string {
    const kw = (k: number) => toks[k]?.kind === 'keyword' ? toks[k].text.toUpperCase() : '';
    switch (kw(0)) {
        case 'WITH': return 'QueryWith';
        case 'SELECT': return 'Query';
        case 'INSERT': return 'InsertStatement';
        case 'UPDATE': return 'UpdateStatement';
        case 'DELETE': return 'DeleteStatement';
        case 'MERGE': return 'MergeStatement';
        case 'TRUNCATE': return 'TruncateStatement';
        case 'DROP': return 'DropStatement';
        case 'ALTER': return 'AlterStatement';
        case 'CREATE': {
            const second = kw(1) === 'OR' ? kw(3) : kw(1);
            if (second === 'TABLE') { return 'CreateTable'; }
            if (second === 'VIEW') { return 'CreateView'; }
            if (second === 'FUNCTION') { return 'CreateFunction'; }
            if (second === 'PROC' || second === 'PROCEDURE') { return 'CreateProcedure'; }
            return 'Query';
        }
        default: return 'Query';
    }
}

/** Statement boundaries on `;`, `GO`, or a bare statement-start keyword at depth 0. Leading comments travel with the statement that follows them. */
export function splitStatements(toks: Tok[]): Tok[][] {
    const out: Tok[][] = [];
    let cur: Tok[] = [];
    let depth = 0;
    let head = '';
    const flush = () => { if (cur.length) { out.push(cur); cur = []; head = ''; } };

    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.kind === 'comment') { cur.push(t); continue; }
        if (t.kind === 'punct') {
            if (t.text === '(') { depth++; }
            else if (t.text === ')') { depth = Math.max(0, depth - 1); }
            else if (t.text === ';' && depth === 0) { cur.push(t); flush(); continue; }
        }
        if (t.kind === 'keyword' && depth === 0) {
            const up = t.text.toUpperCase();
            if (up === 'GO') { flush(); cur.push(t); flush(); continue; }
            if (STATEMENT_START.has(up) && cur.some(x => x.kind !== 'comment')) {
                const prev = [...cur].reverse().find(x => x.kind !== 'comment');
                const prevContinues = prev && (prev.kind === 'keyword' || prev.kind === 'operator' || (prev.kind === 'punct' && prev.text !== ')'));
                if (!prevContinues && !NESTING_HEADS.has(head)) { flush(); }
            }
        }
        if (!head && t.kind === 'keyword') { head = t.text.toUpperCase(); }
        cur.push(t);
    }
    flush();
    return out;
}

export function parse(sql: string): BqsqlDocument {
    const toks = tokenize(sql);
    const items: BqsqlDocumentItem[] = [];
    for (const stmt of splitStatements(toks)) {
        const code = stmt.filter(t => t.kind !== 'comment');
        const comments = stmt.filter(t => t.kind === 'comment').map(leaf);
        if (code.length === 0) { items.push(...comments); continue; }
        const cteNames = collectCteNames(code);
        const body = isKw(code[0], 'WITH') ? buildWith(code, cteNames) : node(statementType(code), buildItems(code, cteNames));
        body.items.push(...comments);
        items.push(body);
    }
    return { items };
}

// ---------------------------------------------------------------------------------------------
// Completion support
// ---------------------------------------------------------------------------------------------

export function collectTableIdentifiers(items: BqsqlDocumentItem[], out: BqsqlDocumentItem[] = []): BqsqlDocumentItem[] {
    for (const it of items) {
        if (it.item_type === 'TableIdentifier') { out.push(it); }
        if (it.items?.length) { collectTableIdentifiers(it.items, out); }
    }
    return out;
}

/** Absolute offset of the first character of every line, for consumers that speak offsets. */
export function lineOffsets(sql: string): number[] {
    const out = [0];
    for (let i = 0; i < sql.length; i++) { if (sql[i] === '\n') { out.push(i + 1); } }
    return out;
}

export function textAt(sql: string, range: number[] | undefined): string {
    if (!range || range.length < 3) { return ''; }
    const line = sql.split('\n')[range[0]] ?? '';
    return line.replace(/\r$/, '').substring(range[1], range[2]);
}

const CHAIN_BEFORE_DOT = /((?:\[[^\]]*\]|"[^"]*"|[\w@#$]+)(?:\.(?:\[[^\]]*\]|"[^"]*"|[\w@#$]+))*)\.\s*[\w]*$/;

/**
 * `alias.` / `table.` / `[db].[s].[t].` before the cursor → the matching TableIdentifier, so the
 * completion provider can list its columns.
 */
export function suggest(sql: string, line: number, character: number): BqsqlSuggestion[] {
    const lineText = (sql.split('\n')[line] ?? '').replace(/\r$/, '');
    const m = CHAIN_BEFORE_DOT.exec(lineText.slice(0, character));
    if (!m) { return []; }
    const wanted = splitChain(m[1]).map(p => p.toLowerCase());
    const wantedJoined = wanted.join('.');

    const doc = parse(sql);
    for (const ti of collectTableIdentifiers(doc.items)) {
        const alias = ti.items.find(c => c.item_type === 'TableIdentifierAlias');
        const chain = ti.items.find(c => c.item_type.startsWith('TableIdentifier') && c.item_type !== 'TableIdentifierAlias');
        if (alias && wanted.length === 1 && unquotePart(textAt(sql, alias.range)).toLowerCase() === wanted[0]) {
            return [{ suggestion_type: 'TableColumns', table_identifier: ti, snippets: [] }];
        }
        if (chain) {
            const parts = splitChain(textAt(sql, chain.range)).map(p => p.toLowerCase());
            if (parts.join('.') === wantedJoined || (wanted.length === 1 && parts[parts.length - 1] === wanted[0])) {
                return [{ suggestion_type: 'TableColumns', table_identifier: ti, snippets: [] }];
            }
        }
    }
    return [];
}
