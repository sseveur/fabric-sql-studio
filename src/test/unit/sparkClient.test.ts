import * as assert from 'assert';
import { buildSparkCode, gridType, parseSparkOutput } from '../../services/sparkClient';

suite('sparkClient', () => {
    test('buildSparkCode embeds the SQL as a safe Python string literal', () => {
        const code = buildSparkCode('SELECT "a", \'b\'\nFROM t', 11);
        assert.ok(code.includes('spark.sql("SELECT \\"a\\", \'b\'\\nFROM t")'), code);
        assert.ok(code.includes('.limit(11)'), code);
    });

    test('parseSparkOutput reads the marker line, maps types, flags truncation', () => {
        const out = 'some warning\n@@FSQL@@' + JSON.stringify({ columns: [['id', 'bigint'], ['amt', 'decimal(10,2)'], ['ts', 'timestamp']], rows: [[1, '2.50', '2026-01-01 00:00:00'], [2, null, null], [3, '1', null]] });
        const set = parseSparkOutput(out, 0, 2);
        assert.deepStrictEqual(set.columns.map(c => c.type), ['bigint', 'decimal', 'datetime2']);
        assert.strictEqual(set.rows.length, 2);
        assert.strictEqual(set.truncated, true);
    });

    test('DDL (no columns) becomes a no-rowset set; missing marker is an error', () => {
        const set = parseSparkOutput('@@FSQL@@{"columns": [], "rows": []}', 1, 10);
        assert.deepStrictEqual([set.index, set.rowsAffected, set.truncated], [1, 0, false]);
        assert.throws(() => parseSparkOutput('Traceback ...', 0, 10), /Unexpected Spark output/);
        assert.strictEqual(gridType('double'), 'float');
        assert.strictEqual(gridType('string'), 'nvarchar');
    });
});
