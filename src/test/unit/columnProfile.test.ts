import * as assert from 'assert';
import { buildProfileSql, buildQuantileSql } from '../../services/columnProfile';

const T = { database: 'Sales', schema: 'dbo', table: 'Or]ders' };

suite('columnProfile SQL', () => {
    test('numeric / orderable: summary row then TOP 20 values, brackets escaped', () => {
        const sql = buildProfileSql(T, 'amount', 'decimal');
        assert.ok(sql.includes('FROM [Sales].[dbo].[Or]]ders]'), sql);
        assert.ok(sql.includes('SELECT TOP 20 v AS value, c AS count'), sql);
        assert.ok(sql.includes('ISNULL(SUM(c), 0)'), sql);
        assert.ok(!/COUNTIF|APPROX_QUANTILES|ARRAY_AGG|`/.test(sql), sql);
    });
    test('bit is widened to int so MIN/MAX are legal', () => {
        assert.ok(buildProfileSql(T, 'flag', 'bit').includes('CAST([flag] AS int) AS v'));
    });
    test('opaque types only count total and NULLs', () => {
        const sql = buildProfileSql(T, 'doc', 'xml');
        assert.ok(sql.startsWith('SELECT COUNT(*) AS total_count, SUM(CASE WHEN [doc] IS NULL THEN 1 ELSE 0 END) AS null_count'), sql);
    });
    test('quantiles: 21 percentiles via PERCENTILE_CONT', () => {
        const sql = buildQuantileSql(T, 'amount');
        assert.strictEqual((sql.match(/\(\d\.\d\d\)/g) || []).length, 21);
        assert.ok(sql.includes('PERCENTILE_CONT(q.p) WITHIN GROUP'), sql);
    });
});
