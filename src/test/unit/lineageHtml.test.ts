import * as assert from 'assert';
import { escapeHtml, exportFilename, LineageSection, renderLineageHtml, renderQuerySection } from '../../lineage/lineageHtml';
import { LineageNode, NodeType } from '../../services/lineageGraph';

const node = (id: string, nodeType: NodeType): LineageNode => ({ id, name: id, fullName: `dbo.${id}`, nodeType, layer: 0 });

const section = (sqlText: string, types: NodeType[], svg = '<svg id="g"></svg>'): LineageSection => ({
    queryInfo: {
        graph: { nodes: types.map((t, i) => node(`n${i}`, t)), edges: [], queryPreview: '' },
        queryIndex: 0, startLine: 3, endLine: 9, sqlText,
    },
    svg,
});

suite('lineageHtml', () => {
    test('escapeHtml covers the five HTML metacharacters', () => {
        assert.strictEqual(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;');
    });

    test('section escapes the SQL preview and embeds the given SVG as-is', () => {
        const html = renderQuerySection(section('SELECT \'<script>alert(1)</script>\' FROM t', ['SOURCE']), 0);
        assert.ok(!html.includes('<script>alert'));
        assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
        assert.ok(html.includes('<div class="graph-wrapper"><svg id="g"></svg></div>'));
    });

    test('section preview collapses whitespace and truncates at 80 chars', () => {
        const long = 'SELECT\n\n   ' + 'x, '.repeat(40) + 'y FROM t';
        const html = renderQuerySection(section(long, ['SOURCE']), 0);
        const preview = /<span class="query-preview-text">([^<]*)<\/span>/.exec(html)![1];
        assert.strictEqual(preview.length, 83);
        assert.ok(preview.startsWith('SELECT x, x, '));
        assert.ok(preview.endsWith('...'));
    });

    test('section numbers from display index, shows line range and pluralised counts', () => {
        const html = renderQuerySection(section('SELECT 1', ['SOURCE', 'SOURCE', 'CTE', 'TARGET']), 1);
        assert.ok(html.includes('data-query-index="1"'));
        assert.ok(html.includes('Query 2'));
        assert.ok(html.includes('Lines 3-9'));
        assert.ok(html.includes('2 sources'));
        assert.ok(html.includes('1 CTE<'));
        assert.ok(html.includes('1 target<'));
    });

    test('section omits CTE and target counts when there are none', () => {
        const html = renderQuerySection(section('SELECT 1', ['SOURCE']), 0);
        assert.ok(html.includes('1 source<'));
        assert.ok(!html.includes(' CTE'));
        assert.ok(!html.includes(' target'));
    });

    test('page header counts queries with singular / plural', () => {
        assert.ok(renderLineageHtml([section('a', ['SOURCE'])], 'dark').includes('1 query with lineage'));
        assert.ok(renderLineageHtml([section('a', ['SOURCE']), section('b', ['SOURCE'])], 'dark').includes('2 queries with lineage'));
    });

    test('export theme is embedded as a JS string that cannot break out of the script', () => {
        assert.ok(renderLineageHtml([], 'light').includes('var exportTheme = "light";'));
        const html = renderLineageHtml([], `x';alert(1);//</script><script>`);
        assert.ok(html.includes(`var exportTheme = "x';alert(1);//\\u003c/script>\\u003cscript>";`));
        assert.strictEqual(html.split('</script>').length, 2);
    });

    test('exportFilename is timestamped, with query number and line range when given', () => {
        const d = new Date(2026, 0, 5, 7, 8, 9);
        assert.strictEqual(exportFilename('png', undefined, undefined, d), 'lineage_query_20260105_070809.png');
        assert.strictEqual(exportFilename('pdf', 0, '3-9', d), 'lineage_query1_lines3-9_20260105_070809.pdf');
        assert.strictEqual(exportFilename('png', 2, undefined, d), 'lineage_query3_20260105_070809.png');
    });
});
