import * as assert from 'assert';
import { DEFAULT_PAGE_SIZE, handleSqlPageMessage, toWireRow } from '../../tableResultsPanel/grid/pagination';

suite('pagination', () => {
    test('DEFAULT_PAGE_SIZE is 50', () => {
        assert.strictEqual(DEFAULT_PAGE_SIZE, 50);
    });

    test('toWireRow wraps positional cells for the grid', () => {
        assert.deepStrictEqual(toWireRow([1, null, 'x']), { f: [{ v: 1 }, { v: null }, { v: 'x' }] });
    });

    test('a reply without a pending request is ignored', () => {
        assert.doesNotThrow(() => handleSqlPageMessage({ requestType: 'sql_page', requestId: 999, rows: [] }));
    });
});
