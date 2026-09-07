import * as assert from 'assert';
import { databasesNamedIn } from '../../services/queryRouter';

suite('queryRouter.databasesNamedIn', () => {

    test('collects the database part of three-part names, lower-cased and de-duplicated', () => {
        const sql = 'SELECT * FROM [Zim_WH_Gold_Dev].[common].[dimAssociate_ref] t JOIN zim_wh_gold_dev.marketing.fct x ON 1=1 JOIN [Other].[dbo].[T] o ON 1=1';
        assert.deepStrictEqual(databasesNamedIn(sql), ['zim_wh_gold_dev', 'other']);
    });

    test('ignores one- and two-part names and CTE references', () => {
        const sql = 'WITH c AS (SELECT 1 AS n FROM dbo.T) SELECT * FROM c JOIN T2 ON 1=1';
        assert.deepStrictEqual(databasesNamedIn(sql), []);
    });

    test('server.db.schema.table keeps the database, db..table keeps the database', () => {
        assert.deepStrictEqual(databasesNamedIn('SELECT * FROM srv.DbA.dbo.T'), ['dba']);
        assert.deepStrictEqual(databasesNamedIn('SELECT * FROM DbB..T'), ['dbb']);
    });
});
