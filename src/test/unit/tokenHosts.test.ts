import * as assert from 'assert';
import * as vscode from 'vscode';
import { ensureTokenHostAllowed, initTokenHosts, isMicrosoftSqlHost, normalizeHost } from '../../services/tokenHosts';

/** In-memory Memento plus a scripted prompt that records how often it was shown. */
function setup(answer: string | undefined) {
    const store = new Map<string, unknown>();
    initTokenHosts({ get: (k: string) => store.get(k), update: async (k: string, v: unknown) => { store.set(k, v); } } as any);
    const prompts: string[] = [];
    (vscode.window as any).showWarningMessage = async (msg: string) => { prompts.push(msg); return answer; };
    return { store, prompts };
}

suite('tokenHosts', () => {
    test('Fabric and Azure SQL endpoints are Microsoft hosts', () => {
        for (const h of [
            'abc123.datawarehouse.fabric.microsoft.com',
            'abc123.database.fabric.microsoft.com',
            'myserver.database.windows.net',
            'mi.public.abc.database.windows.net',
            'ws.sql.azuresynapse.net',
            'x.database.usgovcloudapi.net',
            'x.database.chinacloudapi.cn',
            'ABC.DataWarehouse.Fabric.Microsoft.com',
            'tcp:myserver.database.windows.net,1433',
            'myserver.database.windows.net.',
        ]) {
            assert.ok(isMicrosoftSqlHost(h), h);
        }
    });

    test('anything else needs approval, including look-alikes', () => {
        for (const h of [
            'sql01.corp.local',
            'localhost',
            '10.0.0.5',
            'evil-server.com',
            'fabric.microsoft.com',                              // bare suffix, no subdomain
            'database.windows.net',
            'evilfabric.microsoft.com.attacker.com',
            'x.database.windows.net.attacker.com',
            'xdatabase.windows.net',                             // no dot boundary
            'x.fabric.microsoft.com.evil',
        ]) {
            assert.ok(!isMicrosoftSqlHost(h), h);
        }
    });

    test('normalizeHost strips tcp:, port, instance and case', () => {
        assert.strictEqual(normalizeHost(' TCP:Sql01.Corp.Local,1433 '), 'sql01.corp.local');
        assert.strictEqual(normalizeHost('sql01\\SQLEXPRESS'), 'sql01');
    });

    test('Microsoft hosts never prompt', async () => {
        const { prompts } = setup(undefined);
        await ensureTokenHostAllowed('abc.datawarehouse.fabric.microsoft.com');
        assert.strictEqual(prompts.length, 0);
    });

    test('Allow is asked once, remembered by normalized host', async () => {
        const { store, prompts } = setup('Allow');
        await ensureTokenHostAllowed('sql01.corp.local');
        await ensureTokenHostAllowed('TCP:SQL01.corp.local,1433');
        assert.strictEqual(prompts.length, 1);
        assert.ok(prompts[0].includes('sql01.corp.local'));
        assert.deepStrictEqual(store.get('fabric-sql-approved-token-hosts'), ['sql01.corp.local']);
    });

    test('Cancel throws, stores nothing, and asks again next time', async () => {
        const { store, prompts } = setup(undefined);
        await assert.rejects(ensureTokenHostAllowed('evil-server.com'), /not sent to evil-server\.com/);
        await assert.rejects(ensureTokenHostAllowed('evil-server.com'));
        assert.strictEqual(prompts.length, 2);
        assert.strictEqual(store.get('fabric-sql-approved-token-hosts'), undefined);
    });

    test('parallel connections to one host share a single prompt', async () => {
        const { prompts } = setup('Allow');
        await Promise.all([ensureTokenHostAllowed('onprem'), ensureTokenHostAllowed('onprem'), ensureTokenHostAllowed('ONPREM')]);
        assert.strictEqual(prompts.length, 1);
    });
});
