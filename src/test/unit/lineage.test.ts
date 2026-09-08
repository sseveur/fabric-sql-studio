import * as assert from 'assert';
import { extractCteColumns, extractCtes, getCteNames } from '../../services/cteExtractor';
import { extractCtePreviews } from '../../services/ctePreview';
import { chainAt, resolveColumnAtPosition, resolveTableAtPosition } from '../../services/columnResolver';
import { extractLineage } from '../../services/lineageService';
import { splitQueries } from '../../services/querySplitter';
import { extractTableReferences } from '../../services/sqlTableExtractor';

const SQL = `WITH base AS (
    SELECT o.id, c.name AS customer, total = o.amount
    FROM [Sales].[dbo].[Orders] o
    JOIN dbo.Customers AS c ON c.id = o.customer_id
    WHERE o.id IN (SELECT order_id FROM audit.Flags)
), agg (customer, n) AS (
    SELECT customer, COUNT(*) FROM base GROUP BY customer
)
INSERT INTO [Sales].[rpt].[CustomerCounts]
SELECT * FROM agg CROSS APPLY dbo.fnExtra(agg.n) x;`;

suite('lineage on the T-SQL parser', () => {
    test('extractTableReferences: FROM / JOIN / APPLY / sub-query, brackets normalised, targets excluded', () => {
        const names = extractTableReferences(SQL).map(r => r.name);
        assert.deepStrictEqual(names, ['Sales.dbo.Orders', 'dbo.Customers', 'audit.Flags', 'base', 'agg', 'dbo.fnExtra']);
        const orders = extractTableReferences(SQL)[0];
        assert.deepStrictEqual([orders.line, orders.column], [3, 10]);
    });

    test('extractCtes: names, source tables and CTE-to-CTE references', () => {
        const ctes = extractCtes(SQL);
        assert.deepStrictEqual(ctes.map(c => c.name), ['base', 'agg']);
        assert.deepStrictEqual(ctes[0].sourceTables, ['Sales.dbo.Orders', 'dbo.Customers', 'audit.Flags']);
        assert.deepStrictEqual(ctes[1].referencedCtes, ['base']);
        assert.deepStrictEqual(ctes[1].sourceTables, []);
    });

    test('extractCteColumns: explicit list, alias = expr, AS alias and t.col', () => {
        assert.deepStrictEqual(extractCteColumns(SQL, 'agg').map(c => c.name), ['customer', 'n']);
        assert.deepStrictEqual(extractCteColumns(SQL, 'base').map(c => c.name), ['id', 'customer', 'total']);
        assert.deepStrictEqual(getCteNames(SQL), ['base', 'agg']);
        assert.deepStrictEqual(getCteNames('WITH x AS (SELECT 1 FROM t), [y] AS (SELECT'), ['x', 'y']);
    });

    test('extractLineage: targets by statement kind, alias-resolved UPDATE, sources minus targets', () => {
        const l = extractLineage(SQL);
        assert.deepStrictEqual(l.targets.map(t => [t.fullName, t.statementType]), [['Sales.rpt.CustomerCounts', 'INSERT']]);
        assert.strictEqual(l.targets[0].database, 'Sales');
        assert.ok(l.sources.some(s => s.fullName === 'Sales.dbo.Orders'));

        const upd = extractLineage('UPDATE o SET x = 1 FROM dbo.Orders o JOIN dbo.C c ON c.id = o.id;\nSELECT a INTO #tmp FROM dbo.Src;\nCREATE OR ALTER VIEW rpt.V AS SELECT 1;\nMERGE INTO [T] AS tgt USING dbo.S s ON 1=1 WHEN MATCHED THEN DELETE;');
        assert.deepStrictEqual(upd.targets.map(t => [t.fullName, t.statementType]),
            [['#tmp', 'SELECT INTO'], ['rpt.V', 'CREATE VIEW'], ['T', 'MERGE'], ['dbo.Orders', 'UPDATE']]);
        assert.deepStrictEqual(upd.sources.map(s => s.fullName), ['dbo.C', 'dbo.Src', 'dbo.S']);
    });

    test('splitQueries: offsets exclude the terminator, semicolons in strings ignored, GO dropped', () => {
        const text = "SELECT ';' AS a;\nGO\n-- note\nSELECT 2";
        const q = splitQueries(text);
        assert.deepStrictEqual(q.map(x => x.sql), ["SELECT ';' AS a", 'SELECT 2']);
        assert.strictEqual(text[q[0].endOffset], ';');
        assert.deepStrictEqual([q[1].startLine, q[1].startOffset], [4, text.indexOf('SELECT 2')]);
        assert.strictEqual(splitQueries('   ').length, 1);
    });

    test('extractCtePreviews: TOP n, bracket-quoted name, DECLARE prefix, positional truncation', () => {
        const sql = 'DECLARE @d date = GETDATE();\nWITH a AS (SELECT 1 x), [b] AS (SELECT x FROM a WHERE x > @d)\nSELECT * FROM b';
        const p = extractCtePreviews(sql, 50);
        assert.deepStrictEqual(p.map(x => x.name), ['a', 'b']);
        assert.strictEqual(p[0].previewSql, 'DECLARE @d date = GETDATE();\nWITH a AS (SELECT 1 x)\nSELECT TOP 50 * FROM [a]');
        assert.ok(p[1].previewSql.endsWith('WHERE x > @d)\nSELECT TOP 50 * FROM [b]'));
        assert.strictEqual(sql.slice(p[1].nameOffset, p[1].nameOffset + 3), '[b]');
        assert.deepStrictEqual(extractCtePreviews('WITH a AS (SELECT 1', 10), []);
    });

    test('resolveTableAtPosition: written path, schema.table with default db, alias in scope', () => {
        const at = (needle: string) => SQL.indexOf(needle) + 1;
        assert.deepStrictEqual(resolveTableAtPosition(SQL, at('[Orders]'), 'X'), { database: 'Sales', schema: 'dbo', table: 'Orders' });
        assert.deepStrictEqual(resolveTableAtPosition(SQL, at('Customers'), 'X'), { database: 'X', schema: 'dbo', table: 'Customers' });
        assert.deepStrictEqual(resolveTableAtPosition(SQL, at('c.name'), 'X'), { database: 'X', schema: 'dbo', table: 'Customers' });
        assert.deepStrictEqual(chainAt(SQL, at('[dbo].[Orders]')), ['Sales', 'dbo', 'Orders']);
        assert.strictEqual(resolveTableAtPosition(SQL, at('SELECT o.id'), 'X'), null);
    });

    test('resolveColumnAtPosition: alias lookup, unambiguous bare column, ambiguity error', async () => {
        const cols: Record<string, Array<{ name: string; type: string }>> = {
            'Sales.dbo.Orders': [{ name: 'id', type: 'int' }, { name: 'amount', type: 'decimal' }],
            'X.dbo.Customers': [{ name: 'id', type: 'int' }, { name: 'name', type: 'nvarchar' }],
            'X.audit.Flags': [{ name: 'order_id', type: 'int' }],
        };
        const lookup = async (t: { database: string; schema: string; table: string }) => cols[`${t.database}.${t.schema}.${t.table}`] ?? [];
        const at = (needle: string) => SQL.indexOf(needle) + needle.length - 1;

        const amount = await resolveColumnAtPosition(SQL, at('o.amount'), 'X', lookup);
        assert.deepStrictEqual(amount, { database: 'Sales', schema: 'dbo', table: 'Orders', columnName: 'amount', columnType: 'decimal' });
        const name = await resolveColumnAtPosition(SQL, at('c.name'), 'X', lookup);
        assert.strictEqual(name?.table, 'Customers');
        await assert.rejects(resolveColumnAtPosition('SELECT id FROM dbo.Orders o JOIN dbo.Customers c ON 1=1', 8, 'Sales', async t => cols[`Sales.dbo.${t.table}`] ?? cols[`X.dbo.${t.table}`] ?? []), /ambiguous/);
    });
});
