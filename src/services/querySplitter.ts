import { isKw, lineOffsets, splitStatements, tokenize } from '../language/tsqlParser';

export interface SplitQuery {
    sql: string;
    /** Absolute offsets of the statement text, excluding its terminating `;`. */
    startOffset: number;
    endOffset: number;
    /** 1-based. */
    startLine: number;
    endLine: number;
}

/**
 * Splits a script into statements using the T-SQL tokenizer (semicolons inside strings and
 * comments are ignored; `GO` separators are dropped). Comments are not part of a statement's
 * range — the notebook serializer re-attaches them from the gaps.
 */
export function splitQueries(fullSql: string): SplitQuery[] {
    const offs = lineOffsets(fullSql);
    const out: SplitQuery[] = [];
    for (const stmt of splitStatements(tokenize(fullSql))) {
        const code = stmt.filter(t => t.kind !== 'comment');
        if (code.length && code[code.length - 1].kind === 'punct' && code[code.length - 1].text === ';') { code.pop(); }
        if (!code.length || (code.length === 1 && isKw(code[0], 'GO'))) { continue; }
        const first = code[0];
        const last = code[code.length - 1];
        const startOffset = offs[first.line] + first.start;
        const endOffset = offs[last.line] + last.end;
        const sql = fullSql.substring(startOffset, endOffset).trim();
        if (!sql) { continue; }
        out.push({ sql, startOffset, endOffset, startLine: first.line + 1, endLine: last.line + 1 });
    }
    return out.length ? out : [singleQuery(fullSql)];
}

function singleQuery(sql: string): SplitQuery {
    return { sql: sql.trim(), startOffset: 0, endOffset: sql.length, startLine: 1, endLine: (sql.match(/\n/g) || []).length + 1 };
}
