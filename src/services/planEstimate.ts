/**
 * Summary of a SHOWPLAN_XML document. There is no dry-run byte count in T-SQL; the optimizer's
 * estimated subtree cost and row estimate are the closest pre-execution signal, and on Fabric
 * they are the only one (no $/TB — capacity is billed by CU).
 */
export interface PlanEstimate {
    statements: number;
    /** Sum of StatementSubTreeCost over all statements (optimizer cost units). */
    subtreeCost: number;
    /** Sum of StatementEstRows. */
    estimatedRows: number;
    warnings: string[];
    /** Physical operators seen, most expensive first, for the tooltip. */
    topOperators: string[];
}

export function parsePlanEstimate(xml: string): PlanEstimate {
    const stmts = [...xml.matchAll(/<Stmt\w+\b[^>]*>/g)].map(m => m[0]);
    let cost = 0, rows = 0;
    for (const s of stmts) {
        cost += num(/StatementSubTreeCost="([^"]+)"/.exec(s)?.[1]);
        rows += num(/StatementEstRows="([^"]+)"/.exec(s)?.[1]);
    }

    const warnings = new Set<string>();
    for (const m of xml.matchAll(/<Warnings\b[^>]*>([\s\S]*?)<\/Warnings>/g)) {
        for (const w of m[1].matchAll(/<(\w+)\b/g)) { warnings.add(w[1]); }
    }
    if (/NoJoinPredicate="true"/i.test(xml)) { warnings.add('NoJoinPredicate'); }
    if (/UnmatchedIndexes="true"/i.test(xml)) { warnings.add('UnmatchedIndexes'); }

    const ops = [...xml.matchAll(/<RelOp\b[^>]*PhysicalOp="([^"]+)"[^>]*EstimatedTotalSubtreeCost="([^"]+)"[^>]*>/g)]
        .map(m => ({ op: m[1], cost: num(m[2]) }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5)
        .map(o => `${o.op} (${o.cost.toFixed(3)})`);

    return { statements: stmts.length, subtreeCost: cost, estimatedRows: rows, warnings: [...warnings], topOperators: ops };
}

export function formatEstimate(p: PlanEstimate): string {
    const rows = p.estimatedRows >= 1e6 ? `${(p.estimatedRows / 1e6).toFixed(1)}M` : p.estimatedRows >= 1e3 ? `${(p.estimatedRows / 1e3).toFixed(1)}k` : String(Math.round(p.estimatedRows));
    return `$(graph) est. ${rows} rows · cost ${p.subtreeCost.toFixed(2)}${p.warnings.length ? ` · $(warning) ${p.warnings.length}` : ''}`;
}

function num(v: string | undefined): number {
    const n = Number(v);
    return isFinite(n) ? n : 0;
}
