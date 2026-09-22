import * as assert from 'assert';
import { toCsv, toJsonl } from '../../tableResultsPanel/sqlExport';
import { SqlResultSet } from '../../tableResultsPanel/resultContract';

const SET: SqlResultSet = {
    index: 0, totalRows: 2, truncated: false,
    columns: [{ name: 'id', type: 'int', nullable: false }, { name: 'note', type: 'nvarchar', nullable: true }],
    rows: [[1, 'a,"b"'], [2, null]],
};

suite('sqlExport', () => {
    test('CSV quotes commas and quotes, empty for NULL', () => {
        assert.strictEqual(toCsv(SET), 'id,note\n1,"a,""b"""\n2,\n');
    });
    test('JSONL keeps names and nulls', () => {
        assert.strictEqual(toJsonl(SET), '{"id":1,"note":"a,\\"b\\""}\n{"id":2,"note":null}\n');
    });
});
