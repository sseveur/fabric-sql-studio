import * as vscode from 'vscode';
import { currentProfile, describeToken, getAccessToken, SCOPE_FABRIC } from './auth';
import { listSqlItems, listWorkspaces } from './fabricClient';

/**
 * ponytail: temporary diagnostic for the Spark (Livy) feasibility check. Answers two questions
 * without writing anything: can VS Code's built-in Microsoft sign-in get a token the Livy API
 * accepts, and with which scopes. Delete once Spark support is built or abandoned.
 */
const LIVY_SCOPES = [
    'https://api.fabric.microsoft.com/Lakehouse.Execute.All',
    'https://api.fabric.microsoft.com/Lakehouse.Read.All',
    'https://api.fabric.microsoft.com/Code.AccessFabric.All',
    'https://api.fabric.microsoft.com/Code.AccessStorage.All',
];
const LIVY_VERSION = '2023-12-01';

export async function commandProbeSpark(): Promise<void> {
    const out = vscode.window.createOutputChannel('Fabric SQL: Spark probe');
    out.clear();
    out.show(true);
    const log = (s: string) => out.appendLine(s);

    // 1. Pick a lakehouse (profiles don't store Fabric ids).
    let ws, lh;
    try {
        const workspaces = await listWorkspaces();
        const w = await vscode.window.showQuickPick(workspaces.map(x => ({ label: x.displayName, x })), { title: 'Spark probe (1/2): workspace' });
        if (!w) { return; }
        const lakehouses = (await listSqlItems(w.x.id)).filter(i => i.type === 'Lakehouse');
        if (!lakehouses.length) { vscode.window.showWarningMessage('No lakehouse in that workspace.'); return; }
        const l = await vscode.window.showQuickPick(lakehouses.map(x => ({ label: x.displayName, x })), { title: 'Spark probe (2/2): lakehouse' });
        if (!l) { return; }
        ws = w.x; lh = l.x;
    } catch (e: any) {
        log(`Could not list workspaces / lakehouses: ${e?.message ?? e}`);
        return;
    }
    const base = `https://api.fabric.microsoft.com/v1/workspaces/${ws.id}/lakehouses/${lh.id}/livyapi/versions/${LIVY_VERSION}/sessions`;
    log(`Auth mode: ${currentProfile().mode}`);
    log(`Lakehouse: ${ws.displayName} / ${lh.displayName}`);
    log('');

    // 2. Token A: the .default Fabric token we already use for browsing.
    const tokens: Array<{ label: string; token: string }> = [];
    try {
        const a = await getAccessToken(SCOPE_FABRIC, true);
        if (a) {
            const d = describeToken(a);
            log(`[A] ${SCOPE_FABRIC}: OK · scp = ${d.scopes}`);
            tokens.push({ label: 'A (.default)', token: a.token });
        } else { log('[A] .default: no session'); }
    } catch (e: any) { log(`[A] .default: FAILED · ${e?.message ?? e}`); }

    // 3. Token B: the four scopes the Livy docs ask for, requested explicitly.
    if (currentProfile().mode === 'entra-interactive') {
        try {
            const scopes = [...LIVY_SCOPES];
            const tenant = currentProfile().tenantId;
            if (tenant) { scopes.push(`VSCODE_TENANT:${tenant}`); }
            const s = await vscode.authentication.getSession('microsoft', scopes, { createIfNone: true });
            const d = describeToken({ token: s.accessToken, expiresOn: Date.now(), account: s.account.label });
            log(`[B] explicit Livy scopes: OK · scp = ${d.scopes}`);
            tokens.push({ label: 'B (explicit)', token: s.accessToken });
        } catch (e: any) { log(`[B] explicit Livy scopes: FAILED · ${e?.message ?? e}`); }
    } else {
        log('[B] skipped (azure-cli mode can only request .default)');
    }
    log('');

    // 4. Read-only call: list sessions. Proves the API accepts the token; starts nothing.
    for (const t of tokens) {
        try {
            const res = await fetch(base, { headers: { Authorization: `Bearer ${t.token}` } });
            const body = (await res.text()).slice(0, 300).replace(/\s+/g, ' ');
            log(`GET sessions with token ${t.label}: HTTP ${res.status} · ${body}`);
        } catch (e: any) { log(`GET sessions with token ${t.label}: network error · ${e?.message ?? e}`); }
    }

    // 5. Optional real test: start a session and delete it straight away.
    const usable = tokens.find(() => true);
    if (!usable) { log('\nNo token to test session creation with.'); return; }
    const go = await vscode.window.showInformationMessage(
        'Also create a Spark session and delete it immediately? This starts Spark on the workspace pool (uses capacity for a minute or two).',
        { modal: true }, 'Create and delete');
    if (go !== 'Create and delete') { log('\nSession creation skipped.'); return; }
    for (const t of tokens) {
        try {
            const res = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' }, body: '{}' });
            const text = await res.text();
            log(`\nPOST session with token ${t.label}: HTTP ${res.status} · ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
            if (res.status === 202 || res.status === 200 || res.status === 201) {
                const id = JSON.parse(text)?.id;
                if (id !== undefined) {
                    const del = await fetch(`${base}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t.token}` } });
                    log(`DELETE session ${id}: HTTP ${del.status}`);
                }
                break;  // one real session is enough
            }
        } catch (e: any) { log(`POST session with token ${t.label}: network error · ${e?.message ?? e}`); }
    }
    log('\nDone. Paste this output back.');
}
