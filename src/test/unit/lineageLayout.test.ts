import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { calculateLayout, fitOrdered, getLayoutConfig } from '../../lineage/dagLayout';
import { edgePath, renderGraphToSvg } from '../../lineage/svgRenderer';
import { buildMultiQueryLineage, LineageGraph, NodeType } from '../../services/lineageGraph';

const cfg = getLayoutConfig();

function graph(nodes: Array<[string, number, NodeType?]>, edges: Array<[string, string]>): LineageGraph {
    return {
        nodes: nodes.map(([id, layer, t]) => ({ id, name: id, fullName: id, nodeType: t ?? 'CTE', layer })),
        edges: edges.map(([s, t]) => ({ id: `${s}->${t}`, source: s, target: t })),
        queryPreview: '',
    };
}

/** The layout samples shipped for manual testing, laid out with the real graph builder. */
function samples(): LineageGraph[] {
    const sql = fs.readFileSync(path.join(__dirname, '../../../tests/lineage_samples.fsql'), 'utf8');
    return buildMultiQueryLineage(sql).queries.map(q => q.graph).filter(g => g.nodes.length > 0);
}

suite('lineage layout', () => {
    test('fitOrdered is the closest ordered, spaced fit', () => {
        assert.deepStrictEqual(fitOrdered([0, 0], [1, 1], [0, 10]), [-5, 5]);
        assert.deepStrictEqual(fitOrdered([0, 100], [1, 1], [0, 10]), [0, 100]);   // already feasible: unchanged
        assert.deepStrictEqual(fitOrdered([0, 0], [3, 1], [0, 8]), [-2, 6]);      // heavier item moves less
    });

    test('a straight chain stays on one line', () => {
        const g = graph([['src', 0, 'SOURCE'], ['a', 1], ['b', 2], ['c', 3, 'RESULT']], [['src', 'a'], ['a', 'b'], ['b', 'c']]);
        calculateLayout(g);
        const ys = new Set(g.nodes.map(n => Math.round(n.y!)));
        assert.strictEqual(ys.size, 1);
    });

    test('boxes in one column never overlap and everything is inside the canvas', () => {
        for (const g of samples()) {
            const { width, height } = calculateLayout(g);
            for (const n of g.nodes) {
                assert.ok(n.x! >= cfg.paddingX - 0.01 && n.x! + cfg.nodeWidth <= width - cfg.paddingX + 0.01, `${n.id} x`);
                assert.ok(n.y! >= cfg.paddingY - 0.01 && n.y! + cfg.nodeHeight <= height - cfg.paddingY + 0.01, `${n.id} y`);
                for (const m of g.nodes) {
                    if (m !== n && m.x === n.x) { assert.ok(Math.abs(m.y! - n.y!) >= cfg.nodeSpacing - 0.01, `${n.id} / ${m.id}`); }
                }
            }
        }
    });

    test('edges that skip layers get one lane per skipped layer, clear of every box there', () => {
        let longEdges = 0;
        for (const g of samples()) {
            calculateLayout(g);
            const byId = new Map(g.nodes.map(n => [n.id, n]));
            for (const e of g.edges) {
                const span = Math.round((byId.get(e.target)!.x! - byId.get(e.source)!.x!) / cfg.layerSpacing);
                assert.strictEqual(e.waypoints?.length ?? 0, Math.max(0, span - 1), e.id);
                for (const w of e.waypoints ?? []) {
                    longEdges++;
                    for (const n of g.nodes.filter(n => n.x === w.x)) {
                        const clear = w.y <= n.y! - 8 || w.y >= n.y! + cfg.nodeHeight + 8;
                        assert.ok(clear, `${e.id} lane at ${w.y} runs through ${n.id} (${n.y}..${n.y! + cfg.nodeHeight})`);
                    }
                }
            }
        }
        assert.ok(longEdges >= 5, 'samples exercise long edges');
    });

    test('several edges into one box end at separate points', () => {
        for (const g of samples()) {
            const { width, height } = calculateLayout(g);
            const svg = renderGraphToSvg(g, width, height);
            const ends = new Map<string, string[]>();
            for (const m of svg.matchAll(/d="([^"]+)"[\s\S]*?data-target="([^"]+)"/g)) {
                const coords = m[1].trim().split(/[ ,]+/);
                ends.set(m[2], [...(ends.get(m[2]) ?? []), coords.slice(-2).join(',')]);
            }
            for (const [target, pts] of ends) {
                assert.strictEqual(new Set(pts).size, pts.length, `arrowheads stack on ${target}: ${pts}`);
            }
        }
    });

    test('edge paths leave and arrive horizontally and run straight through skipped columns', () => {
        assert.strictEqual(edgePath({ x: 0, y: 10 }, { x: 100, y: 10 }, [], 160), 'M 0 10 L 100 10');
        assert.strictEqual(edgePath({ x: 0, y: 0 }, { x: 100, y: 40 }, [], 160), 'M 0 0 C 50 0, 50 40, 100 40');
        assert.strictEqual(
            edgePath({ x: 0, y: 0 }, { x: 500, y: 0 }, [{ x: 100, y: 30 }], 160),
            'M 0 0 C 50 0, 50 30, 100 30 L 260 30 C 380 30, 380 0, 500 0');
    });

    test('layout is deterministic', () => {
        const [a, b] = [samples(), samples()];
        a.forEach(g => calculateLayout(g));
        b.forEach(g => calculateLayout(g));
        assert.deepStrictEqual(a.map(g => g.nodes.map(n => [n.id, n.x, n.y])), b.map(g => g.nodes.map(n => [n.id, n.x, n.y])));
    });
});
