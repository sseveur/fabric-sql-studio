import * as assert from 'assert';
import { parse, suggest, tokenize, splitChain, collectTableIdentifiers, textAt } from '../../language/tsqlParser';
import { FsqlDocumentItem } from '../../language/fsqlDocument';

function types(items: FsqlDocumentItem[]): string[] { return items.map(i => i.item_type); }
function flat(items: FsqlDocumentItem[], out: FsqlDocumentItem[] = []): FsqlDocumentItem[] {
    for (const i of items) { out.push(i); flat(i.items, out); }
    return out;
}

suite('tsqlParser', () => {

    test('tokenizer: strings, brackets, comments, variables, temp tables, operators carry offsets', () => {
        const sql = "SELECT [a b], N'it''s', @v, #tmp, 1.5e3 -- tail\nFROM x WHERE y <> 2 /* c */ AND z >= .5";
        const toks = tokenize(sql);
        const texts = toks.map(t => `${t.kind}:${t.text}`);
        assert.deepStrictEqual(texts.slice(0, 10), [
            'keyword:SELECT', 'ident:[a b]', 'punct:,', "string:N'it''s'", 'punct:,', 'ident:@v', 'punct:,', 'ident:#tmp', 'punct:,', 'number:1.5e3',
        ]);
        assert.strictEqual(toks.find(t => t.kind === 'comment')?.text, '-- tail');
        const neq = toks.find(t => t.text === '<>')!;
        assert.deepStrictEqual([neq.line, neq.start, neq.end], [1, 15, 17]);
        assert.ok(toks.some(t => t.text === '>='));
        assert.ok(!toks.some(t => t.text.includes('/*')), 'block comment must not become a token');
    });

    test('block comment spanning lines is skipped entirely', () => {
        const toks = tokenize('SELECT 1 /* a\nb\nc */ , 2');
        assert.deepStrictEqual(toks.map(t => t.text), ['SELECT', '1', ',', '2']);
    });

    test('FROM/JOIN identifiers become TableIdentifier groups with part-count types and aliases', () => {
        const sql = 'SELECT * FROM [Zim].[dbo].[T1] t INNER JOIN dbo.T2 AS x ON t.id = x.id LEFT JOIN T3 ON 1=1';
        const doc = parse(sql);
        const tis = collectTableIdentifiers(doc.items);
        assert.strictEqual(tis.length, 3);
        assert.deepStrictEqual(types(tis[0].items), ['TableIdentifierProjectIdDatasetIdTableId', 'TableIdentifierAlias']);
        assert.strictEqual(textAt(sql, tis[0].items[0].range), '[Zim].[dbo].[T1]');
        assert.strictEqual(textAt(sql, tis[0].items[1].range), 't');
        assert.deepStrictEqual(types(tis[1].items), ['TableIdentifierDatasetIdTableId', 'Keyword', 'TableIdentifierAlias']);
        assert.deepStrictEqual(types(tis[2].items), ['TableIdentifierTableId']);
    });

    test('WITH block yields QueryWith with TableCteId, AS and a nested Query per CTE; references resolve to TableCteId', () => {
        const sql = 'WITH a AS (SELECT 1 AS x FROM dbo.T), b (y) AS (SELECT x FROM a)\nSELECT * FROM b JOIN a ON 1=1;';
        const doc = parse(sql);
        assert.strictEqual(doc.items.length, 1);
        const w = doc.items[0];
        assert.strictEqual(w.item_type, 'QueryWith');
        const seq = types(w.items);
        assert.deepStrictEqual(seq.slice(0, 5), ['Keyword', 'TableCteId', 'Keyword', 'ParenthesesOpen', 'Query']);
        assert.strictEqual(seq.filter(t => t === 'TableCteId').length, 2);
        // references to a / b after the CTE list resolve as CTE ids, dbo.T stays a table
        const refs = collectTableIdentifiers(w.items).map(ti => ti.items[0].item_type);
        assert.deepStrictEqual(refs, ['TableIdentifierDatasetIdTableId', 'TableCteId', 'TableCteId', 'TableCteId']);
    });

    test('statements split on ; and on a new statement keyword, but not inside WITH or INSERT ... SELECT', () => {
        // T-SQL itself requires ';' before WITH and after INSERT ... SELECT, so only bare SELECTs split on keyword.
        const sql = 'SELECT 1\nSELECT 2;\nINSERT INTO t (a) SELECT a FROM u;\nWITH c AS (SELECT 1 AS n) SELECT n FROM c;\nUPDATE t SET a = 1';
        const doc = parse(sql);
        assert.deepStrictEqual(types(doc.items), ['Query', 'Query', 'InsertStatement', 'QueryWith', 'UpdateStatement']);
    });

    test('CREATE variants and DML get their statement types; parenthesised sub-select nests a Query', () => {
        const doc = parse('CREATE OR ALTER VIEW v AS SELECT * FROM (SELECT 1 AS a) s; CREATE TABLE dbo.t (id INT); DELETE FROM dbo.t WHERE id = 1; MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE;');
        assert.deepStrictEqual(types(doc.items), ['CreateView', 'CreateTable', 'DeleteStatement', 'MergeStatement']);
        assert.ok(flat(doc.items[0].items).some(i => i.item_type === 'Query'), 'sub-select should nest');
        const del = collectTableIdentifiers(doc.items[2].items);
        assert.strictEqual(del.length, 1);
        assert.strictEqual(del[0].items[0].item_type, 'TableIdentifierDatasetIdTableId');
    });

    test('splitChain unquotes and keeps db..table gaps', () => {
        assert.deepStrictEqual(splitChain('[my.db].[s]].x].t'), ['my.db', 's].x', 't']);
        assert.deepStrictEqual(splitChain('db..t'), ['db', '', 't']);
        assert.deepStrictEqual(splitChain('"q".t'), ['q', 't']);
    });

    test('suggest resolves alias., table. and full chain. to the TableIdentifier', () => {
        const sql = 'SELECT t. FROM [Zim].[dbo].[Orders] AS t JOIN dbo.Lines l ON 1=1';
        const byAlias = suggest(sql, 0, 9);
        assert.strictEqual(byAlias.length, 1);
        assert.strictEqual(byAlias[0].suggestion_type, 'TableColumns');
        assert.strictEqual(textAt(sql, byAlias[0].table_identifier.items[0].range), '[Zim].[dbo].[Orders]');

        const sql2 = 'SELECT Lines. FROM dbo.Lines';
        assert.strictEqual(suggest(sql2, 0, 13).length, 1);
        const sql3 = 'SELECT [dbo].[Lines]. FROM dbo.Lines';
        assert.strictEqual(suggest(sql3, 0, 21).length, 1);
        assert.strictEqual(suggest('SELECT nope. FROM dbo.Lines', 0, 12).length, 0);
        assert.strictEqual(suggest('SELECT x FROM dbo.Lines', 0, 8).length, 0);
    });

    test('leaves only carry ranges; statement nodes have none', () => {
        const doc = parse('SELECT 1;\nSELECT 2;');
        for (const stmt of doc.items) { assert.deepStrictEqual(stmt.range, []); }
        for (const l of flat(doc.items).filter(i => i.items.length === 0)) { assert.strictEqual(l.range.length, 3); }
    });
});
