import * as assert from 'assert';
import { escapeMarkdown, MAX_HOVER_COLUMNS, renderHoverCard } from '../../language/hoverCards';

suite('hoverCards', () => {
    test('source card: tag in the lineage colour, name, muted db.schema, typed columns right-aligned', () => {
        const md = renderHoverCard({
            kind: 'SOURCE', name: 'orders', subtitle: 'WH.raw',
            columns: [{ name: 'order_id', type: 'int' }, { name: 'note', type: 'nvarchar' }, { name: 'at', type: 'datetime2' }, { name: 'ok', type: 'bit' }],
        });
        const [header, , count, align, ...rows] = md.split('\n');
        assert.ok(header.startsWith('$(database) <span style="color:#3b9eff;background-color:#3b9eff26;">&nbsp;<strong>SRC</strong>&nbsp;</span>'));
        assert.ok(header.includes('**orders**'));
        assert.ok(header.includes('<span style="color:var(--vscode-descriptionForeground);">WH\\.raw</span>'));
        assert.strictEqual(count, '| | 4 columns | |');
        assert.strictEqual(align, '|:-:|:--|--:|');
        assert.deepStrictEqual(rows.map(r => r.split(' | ')[0]), ['| $(symbol-numeric)', '| $(symbol-string)', '| $(calendar)', '| $(symbol-boolean)']);
        assert.ok(rows[0].includes('order\\_id') && rows[0].includes('>int</span>'));
    });

    test('CTE card: violet tag, untyped columns get the plain field icon and no type', () => {
        const md = renderHoverCard({ kind: 'CTE', name: 'stg', subtitle: 'line 12', columns: [{ name: 'total' }] });
        assert.ok(md.startsWith('$(package) <span style="color:#a371f7;'));
        assert.ok(md.includes('>CTE</strong>'));
        assert.ok(md.endsWith('| $(symbol-field) | total |  |'));
        assert.ok(md.includes('| | 1 column | |'));
    });

    test('loading / empty states show a muted note instead of a table', () => {
        assert.ok(renderHoverCard({ kind: 'SOURCE', name: 't', columns: [], note: 'Loading columns…' }).endsWith('<em>Loading columns…</em></span>'));
        assert.ok(renderHoverCard({ kind: 'CTE', name: 'c', columns: [] }).includes('<em>No columns detected</em>'));
    });

    test('long tables are capped with a "+ N more" row', () => {
        const md = renderHoverCard({ kind: 'SOURCE', name: 't', columns: Array.from({ length: MAX_HOVER_COLUMNS + 3 }, (_, i) => ({ name: `c${i}` })) });
        assert.ok(md.includes('<em>+ 3 more</em>'));
        assert.ok(!md.includes(` c${MAX_HOVER_COLUMNS} `));
    });

    test('names from the catalog or SQL cannot become links, icons, markup or break the table', () => {
        const hostile = '[run](command:workbench.action.terminal.new) $(alert) <img src=x onerror=1> a|b *x* `c`';
        const md = renderHoverCard({ kind: 'SOURCE', name: hostile, subtitle: hostile, columns: [{ name: hostile, type: hostile }] });
        assert.ok(!md.includes('](command:'));
        assert.ok(!md.includes('$(alert)'));
        assert.ok(!md.includes('<img'));
        const row = md.split('\n').pop()!;
        assert.strictEqual(row.split(/(?<!\\)\|/).length, 5, 'column row keeps exactly 3 cells');
        assert.strictEqual(escapeMarkdown('a\nb'), 'a b');
    });
});
