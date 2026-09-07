import * as assert from 'assert';
import { bracket, displayName, parseKey, qualifiedName, refKeyCI, refToKey, sameRef, splitDotted, ObjectRef } from '../../services/objectRef';

suite('objectRef', () => {

    const orders: ObjectRef = { conn: 'prod-dw', database: 'Sales', schema: 'dbo', name: 'Orders', kind: 'table' };

    test('refToKey / parseKey round-trip', () => {
        const key = refToKey(orders);
        assert.strictEqual(key, 'prod-dw/Sales.dbo.Orders');
        assert.deepStrictEqual(parseKey(key), orders);
    });

    test('parts with dots or brackets are bracket-quoted and round-trip', () => {
        const odd: ObjectRef = { conn: 'c', database: 'my.db', schema: 'we]ird', name: 'a/b', kind: 'table' };
        const key = refToKey(odd);
        assert.strictEqual(key, 'c/[my.db].[we]]ird].[a/b]');
        assert.deepStrictEqual(parseKey(key), odd);
    });

    test('qualifiedName always brackets every part', () => {
        assert.strictEqual(qualifiedName(orders), '[Sales].[dbo].[Orders]');
        assert.strictEqual(qualifiedName({ conn: 'c', database: 'D', kind: 'database' }), '[D]');
        assert.strictEqual(bracket('x]y'), '[x]]y]');
    });

    test('displayName quotes only when needed', () => {
        assert.strictEqual(displayName(orders), 'Sales.dbo.Orders');
        assert.strictEqual(displayName({ ...orders, name: 'a.b' }), 'Sales.dbo.[a.b]');
    });

    test('splitDotted honours brackets and doubled ]', () => {
        assert.deepStrictEqual(splitDotted('a.[b.c].d'), ['a', 'b.c', 'd']);
        assert.deepStrictEqual(splitDotted('[x]]y].z'), ['x]y', 'z']);
        assert.deepStrictEqual(splitDotted('plain'), ['plain']);
    });

    test('parseKey infers kind from depth and rejects keys without a connection', () => {
        assert.strictEqual(parseKey('c/Sales')?.kind, 'database');
        assert.strictEqual(parseKey('c/Sales.dbo')?.kind, 'schema');
        assert.strictEqual(parseKey('c/Sales.dbo.V', 'view')?.kind, 'view');
        assert.strictEqual(parseKey('c')?.kind, undefined);
        assert.strictEqual(parseKey('/x'), null);
    });

    test('matching is case-insensitive like the default SQL Server collation', () => {
        const upper: ObjectRef = { ...orders, database: 'SALES', name: 'ORDERS' };
        assert.strictEqual(refKeyCI(upper), refKeyCI(orders));
        assert.ok(sameRef(upper, orders));
        assert.ok(!sameRef(orders, { ...orders, schema: 'archive' }));
    });
});
