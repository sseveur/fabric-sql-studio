/**
 * SHOWPLAN_XML → something a person can read. There is no dry-run byte count in T-SQL; the
 * optimizer's estimated rows / subtree cost are the pre-execution signal, and on Fabric the only
 * one (capacity is billed by CU, not $/TB).
 *
 * ponytail: regex/tag-scanner parsing, no XML dependency. SHOWPLAN is machine-generated and
 * well-formed, and we only read a handful of attributes.
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

export interface PlanNode {
    physicalOp: string;
    logicalOp: string;
    estimateRows: number;
    /** Cumulative cost of this operator and everything below it. */
    subtreeCost: number;
    estimateIO: number;
    estimateCPU: number;
    /** `[db].[schema].[table]` (+ index) this operator reads, if any. */
    object?: string;
    children: PlanNode[];
}

export interface PlanStatement {
    text: string;
    type: string;
    subtreeCost: number;
    estimateRows: number;
    warnings: string[];
    root?: PlanNode;
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

/** One entry per statement with its operator tree. */
export function parsePlanStatements(xml: string): PlanStatement[] {
    const out: PlanStatement[] = [];
    const stmtRe = /<(Stmt\w+)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    for (const m of xml.matchAll(stmtRe)) {
        const attrs = m[2];
        const body = m[3];
        const warnings = new Set<string>();
        for (const w of body.matchAll(/<Warnings\b[^>]*>([\s\S]*?)<\/Warnings>/g)) {
            for (const t of w[1].matchAll(/<(\w+)\b/g)) { warnings.add(t[1]); }
        }
        out.push({
            text: unescapeXml(attr(attrs, 'StatementText')),
            type: attr(attrs, 'StatementType') || m[1].replace(/^Stmt/, ''),
            subtreeCost: num(attr(attrs, 'StatementSubTreeCost')),
            estimateRows: num(attr(attrs, 'StatementEstRows')),
            warnings: [...warnings],
            root: parseRelOps(body)[0],
        });
    }
    return out;
}

/** Builds the RelOp tree by scanning open/close tags in order. */
function parseRelOps(body: string): PlanNode[] {
    const roots: PlanNode[] = [];
    const stack: PlanNode[] = [];
    // Each RelOp open tag, close tag, or Object element, in document order.
    const tokenRe = /<RelOp\b([^>]*)>|<\/RelOp>|<Object\b([^>]*)\/?>/g;
    for (const t of body.matchAll(tokenRe)) {
        if (t[0].startsWith('</RelOp')) { stack.pop(); continue; }
        if (t[0].startsWith('<Object')) {
            const top = stack[stack.length - 1];
            if (top && !top.object) {
                const a = t[2];
                const parts = ['Database', 'Schema', 'Table'].map(k => attr(a, k)).filter(Boolean);
                const index = attr(a, 'Index');
                top.object = parts.join('.') + (index ? ` ${index}` : '');
            }
            continue;
        }
        const a = t[1];
        const node: PlanNode = {
            physicalOp: attr(a, 'PhysicalOp'),
            logicalOp: attr(a, 'LogicalOp'),
            estimateRows: num(attr(a, 'EstimateRows')),
            subtreeCost: num(attr(a, 'EstimatedTotalSubtreeCost')),
            estimateIO: num(attr(a, 'EstimateIO')),
            estimateCPU: num(attr(a, 'EstimateCPU')),
            children: [],
        };
        const parent = stack[stack.length - 1];
        if (parent) { parent.children.push(node); } else { roots.push(node); }
        stack.push(node);
    }
    return roots;
}

export function formatEstimate(p: PlanEstimate): string {
    return `$(graph) est. ${fmtRows(p.estimatedRows)} rows · cost ${p.subtreeCost.toFixed(2)}${p.warnings.length ? ` · $(warning) ${p.warnings.length}` : ''}`;
}

export function fmtRows(n: number): string {
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
}

/** Plan panel HTML: per statement, an indented operator tree with rows / cost / % of statement. No scripts. */
export function renderPlanHtml(statements: PlanStatement[], connectionId: string, raw = ''): string {
    const blocks = statements.map((s, i) => {
        const total = s.subtreeCost || 1;
        const rows: string[] = [];
        const walk = (n: PlanNode, depth: number) => {
            const own = Math.max(0, n.subtreeCost - n.children.reduce((a, c) => a + c.subtreeCost, 0));
            const pct = Math.round((own / total) * 100);
            const op = n.logicalOp && n.logicalOp !== n.physicalOp ? `${esc(n.physicalOp)} <span class="dim">(${esc(n.logicalOp)})</span>` : esc(n.physicalOp);
            rows.push(`<tr>
  <td class="op" style="padding-left:${8 + depth * 18}px"><span class="tree">${depth ? '└ ' : ''}</span>${op}${n.object ? `<div class="obj">${esc(n.object)}</div>` : ''}</td>
  <td class="num">${esc(fmtRows(n.estimateRows))}</td>
  <td class="num">${n.subtreeCost.toFixed(4)}</td>
  <td class="bar"><div class="fill" style="width:${pct}%"></div><span>${pct}%</span></td>
</tr>`);
            for (const c of n.children) { walk(c, depth + 1); }
        };
        if (s.root) { walk(s.root, 0); }
        return `<section>
  <h2>Statement ${i + 1} <span class="dim">${esc(s.type)}</span> — est. ${esc(fmtRows(s.estimateRows))} rows · cost ${s.subtreeCost.toFixed(4)}</h2>
  <pre class="sql">${esc(s.text)}</pre>
  ${s.warnings.length ? `<p class="warn">⚠ ${s.warnings.map(esc).join(', ')}</p>` : ''}
  <table class="plan"><thead><tr><th>Operator</th><th class="num">Est. rows</th><th class="num">Subtree cost</th><th>Own cost</th></tr></thead>
  <tbody>${rows.join('')}</tbody></table>
</section>`;
    }).join('');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 10px 16px 24px; }
  h1 { font-size: 14px; margin: 0 0 4px; } .sub { color: var(--vscode-descriptionForeground); margin-bottom: 14px; }
  h2 { font-size: 13px; margin: 18px 0 6px; } .dim { color: var(--vscode-descriptionForeground); font-weight: normal; }
  pre.sql { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 4px; white-space: pre-wrap; max-height: 160px; overflow: auto; font-size: 12px; }
  table.plan { border-collapse: collapse; width: 100%; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  th { text-align: left; color: var(--vscode-descriptionForeground); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border); }
  td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border); vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .tree { color: var(--vscode-descriptionForeground); } .obj { color: var(--vscode-textLink-foreground); font-size: 11px; margin-top: 2px; }
  td.bar { width: 140px; position: relative; } .fill { position: absolute; left: 8px; top: 6px; bottom: 6px; background: var(--vscode-charts-orange, #ce9178); opacity: .35; border-radius: 2px; }
  td.bar span { position: relative; padding-left: 4px; }
  .warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  .note { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 20px; }
</style></head><body>
<h1>Estimated execution plan</h1>
<div class="sub">${esc(connectionId)} · nothing was executed · costs are optimizer units, comparable between plans on the same endpoint</div>
${blocks || noPlanHtml(raw)}
<p class="note">"Own cost" is the operator's share of the statement's subtree cost. Use <b>Fabric SQL: Show Estimated Plan XML</b> for the raw SHOWPLAN.</p>
</body></html>`;
}

/** Shown when nothing parsed: the endpoint's raw reply (head) so the failure is diagnosable. */
function noPlanHtml(raw: string): string {
    if (!raw.trim()) { return '<p class="warn">The endpoint returned no plan output for SET SHOWPLAN_XML ON.</p>'; }
    return `<p class="warn">Plan output could not be parsed (${raw.length} chars). First part of the reply:</p><pre class="sql">${esc(raw.slice(0, 3000))}</pre>`;
}

/** SQL Server returns SHOWPLAN XML on one line; indent it for reading. */
export function prettyXml(xml: string): string {
    const compact = xml.replace(/>\s*</g, '><').replace(/<(\w+)([^>]*)><\/\1>/g, '<$1$2/>');
    const tokens = compact.split(/(?=<)|(?<=>)/).filter(t => t.length > 0);
    let depth = 0;
    let inlineText = false;
    const out: string[] = [];
    for (const t of tokens) {
        if (/^<\?/.test(t)) { out.push(t); continue; }
        if (/^<\//.test(t)) {
            depth = Math.max(0, depth - 1);
            if (inlineText) { out[out.length - 1] += t; inlineText = false; } else { out.push('  '.repeat(depth) + t); }
            continue;
        }
        if (/^<[^>]*\/>$/.test(t)) { out.push('  '.repeat(depth) + t); continue; }
        if (/^</.test(t)) { out.push('  '.repeat(depth) + t); depth++; continue; }
        out[out.length - 1] += t;   // text content stays on its element's line
        inlineText = true;
    }
    return out.join('\n');
}

function attr(attrs: string, name: string): string {
    return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
}

function unescapeXml(s: string): string {
    return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function esc(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(v: string | undefined): number {
    const n = Number(v);
    return isFinite(n) ? n : 0;
}
