import { isKw, lineOffsets, matchingParen, splitStatements, Tok, tokenize, unquotePart } from '../language/tsqlParser';
import { bracket } from './objectRef';

export interface CtePreview {
    /** CTE name as written (unquoted). */
    name: string;
    /** Character offset of the CTE name in the source — used to place the CodeLens. */
    nameOffset: number;
    /**
     * Rewritten query that selects from this CTE. Keeps every CTE from the start of the WITH
     * clause through this one verbatim (a CTE can only reference earlier ones, so its whole
     * dependency chain is included) and appends `SELECT TOP n * FROM [cte]`.
     */
    previewSql: string;
}

/**
 * One preview per CTE of each top-level WITH statement. Preceding DECLARE / SET statements are
 * prepended so variables resolve when the preview runs alone. Nested WITHs inside sub-queries
 * are ignored — only CTEs the user can reference at top level are surfaced.
 */
export function extractCtePreviews(sql: string, rowLimit: number): CtePreview[] {
    const limit = Number.isFinite(rowLimit) && rowLimit > 0 ? Math.floor(rowLimit) : 100;
    const offs = lineOffsets(sql);
    const startOf = (t: Tok) => offs[t.line] + t.start;
    const endOf = (t: Tok) => offs[t.line] + t.end;
    const textOf = (toks: Tok[]) => sql.slice(startOf(toks[0]), endOf(toks[toks.length - 1]));

    const stmts = splitStatements(tokenize(sql))
        .map(s => s.filter(t => t.kind !== 'comment'))
        .filter(s => s.length > 0);

    const previews: CtePreview[] = [];
    for (let si = 0; si < stmts.length; si++) {
        const toks = stmts[si];
        if (!isKw(toks[0], 'WITH')) { continue; }

        const prefixParts = stmts.slice(0, si)
            .filter(s => isKw(s[0], 'DECLARE') || isKw(s[0], 'SET'))
            .map(s => textOf(s).replace(/;\s*$/, '') + ';');
        const prefix = prefixParts.length ? prefixParts.join('\n') + '\n' : '';

        let i = 1;
        while (i < toks.length && toks[i].kind === 'ident') {
            const nameTok = toks[i++];
            if (toks[i]?.kind === 'punct' && toks[i].text === '(') { i = matchingParen(toks, i) + 1; }   // column list
            if (!isKw(toks[i], 'AS')) { break; }
            i++;
            if (!(toks[i]?.kind === 'punct' && toks[i].text === '(')) { break; }
            const close = matchingParen(toks, i);
            if (toks[close]?.text !== ')') { break; }                                                // unterminated body
            const name = unquotePart(nameTok.text);
            const head = sql.slice(startOf(toks[0]), endOf(toks[close]));
            previews.push({ name, nameOffset: startOf(nameTok), previewSql: `${prefix}${head}\nSELECT TOP ${limit} * FROM ${bracket(name)}` });
            i = close + 1;
            if (toks[i]?.kind === 'punct' && toks[i].text === ',') { i++; continue; }
            break;
        }
    }
    return previews;
}
