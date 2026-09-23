import * as vscode from 'vscode';
import { getAccessToken, SCOPE_FABRIC } from './auth';
import { listSqlItems, listWorkspaces } from './fabricClient';
import { splitQueries } from './querySplitter';
import { SqlResultSet } from '../tableResultsPanel/resultContract';

/**
 * Spark SQL over the Fabric Livy API. One interactive session per lakehouse, created on first
 * use and reused until it dies (Fabric stops idle sessions after 20 minutes) or the user stops it.
 * Each statement runs as PySpark that prints the rows as JSON; results come back in the same
 * SqlResultSet shape as TDS so the grid, exports and notebooks need nothing new.
 *
 * Auth: the plain Fabric REST token (`.default`, scp user_impersonation) is accepted by Livy —
 * verified 2026-09-23. The explicit Lakehouse.* / Code.* scopes are refused for VS Code's client.
 */

export const SETTING_SPARK_LAKEHOUSE = 'fabricSql.sparkLakehouse';
const LIVY_VERSION = '2023-12-01';
const MARKER = '@@FSQL@@';
const START_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_STOP_MS = 20 * 60 * 1000;
/** ponytail: rows travel inside one Livy text/plain payload; cap below maxRows. Page via OFFSET if users need more. */
const SPARK_ROW_CAP = 10000;

export interface SparkTarget {
    workspaceId: string;
    lakehouseId: string;
    /** "workspace / lakehouse", for display. */
    label: string;
}

interface LiveSession { id: string; url: string; }
const sessions = new Map<string, LiveSession>();

// ---------------------------------------------------------------------------------------------
// Target lakehouse
// ---------------------------------------------------------------------------------------------

export function getSparkTarget(): SparkTarget | undefined {
    const t = vscode.workspace.getConfiguration().get<SparkTarget>(SETTING_SPARK_LAKEHOUSE);
    return t?.workspaceId && t?.lakehouseId ? t : undefined;
}

export async function pickSparkTarget(): Promise<SparkTarget | undefined> {
    const workspaces = await listWorkspaces();
    const w = await vscode.window.showQuickPick(workspaces.map(x => ({ label: x.displayName, x })), { title: 'Spark lakehouse (1/2): workspace' });
    if (!w) { return undefined; }
    const lakehouses = (await listSqlItems(w.x.id)).filter(i => i.type === 'Lakehouse');
    if (!lakehouses.length) { vscode.window.showWarningMessage(`No lakehouse in ${w.x.displayName}.`); return undefined; }
    const l = await vscode.window.showQuickPick(lakehouses.map(x => ({ label: x.displayName, x })), { title: 'Spark lakehouse (2/2): lakehouse' });
    if (!l) { return undefined; }
    const target: SparkTarget = { workspaceId: w.x.id, lakehouseId: l.x.id, label: `${w.x.displayName} / ${l.x.displayName}` };
    const previous = getSparkTarget();
    if (previous && keyOf(previous) !== keyOf(target)) { await stopSparkSessions(); }   // don't leave the old one burning capacity
    await vscode.workspace.getConfiguration().update(SETTING_SPARK_LAKEHOUSE, target, vscode.ConfigurationTarget.Global);
    return target;
}

// ---------------------------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------------------------

let status: vscode.StatusBarItem | undefined;
let idleTimer: NodeJS.Timeout | undefined;

function setStatus(text: string | null, target?: SparkTarget): void {
    if (!status) {
        status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        status.command = 'fabricSql.stop-spark-session';
    }
    if (text === null) { status.hide(); return; }
    status.text = `$(zap) Spark: ${text}`;
    status.tooltip = `${target?.label ?? ''}\nClick to stop the Spark session.`;
    status.show();
}

function markIdle(target: SparkTarget): void {
    setStatus('idle', target);
    if (idleTimer) { clearTimeout(idleTimer); }
    // Fabric ends the session after 20 idle minutes; mirror that so the status bar doesn't lie.
    idleTimer = setTimeout(() => { sessions.delete(keyOf(target)); setStatus(null); }, IDLE_STOP_MS);
}

// ---------------------------------------------------------------------------------------------
// Livy plumbing
// ---------------------------------------------------------------------------------------------

function keyOf(t: SparkTarget): string { return `${t.workspaceId}/${t.lakehouseId}`; }

function sessionsUrl(t: SparkTarget): string {
    return `https://api.fabric.microsoft.com/v1/workspaces/${t.workspaceId}/lakehouses/${t.lakehouseId}/livyapi/versions/${LIVY_VERSION}/sessions`;
}

async function livy(url: string, method = 'GET', body?: unknown): Promise<{ status: number; json: any }> {
    const tok = await getAccessToken(SCOPE_FABRIC, true);
    if (!tok) { throw new Error('Not signed in. Use the Authentication view to sign in first.'); }
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${tok.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
    if (res.status >= 400 && res.status !== 404) {
        throw new Error(`Livy API ${res.status}: ${json?.message ?? json?.error?.message ?? text.slice(0, 300)}`);
    }
    return { status: res.status, json };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A session in `idle` state, reusing the cached one when it is still alive. */
async function readySession(target: SparkTarget, token: vscode.CancellationToken, onState: (s: string) => void): Promise<LiveSession> {
    let s = sessions.get(keyOf(target));
    if (s) {
        const { status: code, json } = await livy(s.url);
        const state = code === 404 ? 'dead' : String(json?.state ?? json?.livyInfo?.currentState ?? 'dead');
        if (!['idle', 'busy', 'starting', 'not_started'].includes(state)) { s = undefined; }
    }
    if (!s) {
        const { json } = await livy(sessionsUrl(target), 'POST', {});
        if (!json?.id) { throw new Error('Livy did not return a session id.'); }
        s = { id: String(json.id), url: `${sessionsUrl(target)}/${json.id}` };
        sessions.set(keyOf(target), s);
    }

    const started = Date.now();
    for (;;) {
        if (token.isCancellationRequested) { throw new Error('Cancelled.'); }
        const { status: code, json } = await livy(s.url);
        const state = code === 404 ? 'dead' : String(json?.state ?? 'unknown');
        onState(state);
        if (state === 'idle') { return s; }
        if (['dead', 'error', 'killed', 'shutting_down', 'success'].includes(state)) {
            sessions.delete(keyOf(target));
            throw new Error(`Spark session ended while starting (state: ${state}).`);
        }
        if (Date.now() - started > START_TIMEOUT_MS) { throw new Error('Spark session did not start within 10 minutes.'); }
        await sleep(state === 'busy' ? 1000 : 3000);
    }
}

async function runStatement(s: LiveSession, code: string, token: vscode.CancellationToken): Promise<string> {
    const { json: posted } = await livy(`${s.url}/statements`, 'POST', { code, kind: 'pyspark' });
    const stmtUrl = `${s.url}/statements/${posted?.id}`;
    const cancel = token.onCancellationRequested(() => { livy(`${stmtUrl}/cancel`, 'POST', {}).catch(() => undefined); });
    try {
        let delay = 500;
        for (;;) {
            const { json } = await livy(stmtUrl);
            const state = String(json?.state ?? '');
            if (state === 'available') {
                const out = json.output ?? {};
                if (out.status === 'error') {
                    throw new Error(`${out.ename ?? 'Error'}: ${firstLine(out.evalue ?? '')}`);
                }
                return String(out.data?.['text/plain'] ?? '');
            }
            if (state === 'error' || state === 'cancelled' || state === 'cancelling') {
                throw new Error(token.isCancellationRequested ? 'Cancelled.' : `Statement ${state}.`);
            }
            await sleep(delay);
            delay = Math.min(delay * 1.5, 3000);
        }
    } finally {
        cancel.dispose();
    }
}

function firstLine(s: string): string {
    // Spark AnalysisExceptions carry a long plan dump after the first line.
    return s.split('\n').find(l => l.trim())?.trim() ?? s;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------------------------

/** PySpark that runs one Spark SQL statement and prints columns + up to `limit` rows as JSON after a marker. */
export function buildSparkCode(sql: string, limit: number): string {
    return [
        'import json as _fsql_json',
        `_fsql_df = spark.sql(${JSON.stringify(sql)})`,
        '_fsql_cols = [[f.name, f.dataType.simpleString()] for f in _fsql_df.schema.fields]',
        `_fsql_rows = [list(r) for r in _fsql_df.limit(${limit}).collect()] if _fsql_cols else []`,
        `print(${JSON.stringify(MARKER)} + _fsql_json.dumps({"columns": _fsql_cols, "rows": _fsql_rows}, default=str))`,
    ].join('\n');
}

/** Spark simpleString types → the T-SQL names the grid already knows how to align and chart. */
export function gridType(sparkType: string): string {
    const t = sparkType.toLowerCase();
    if (t.startsWith('decimal')) { return 'decimal'; }
    if (t.startsWith('timestamp')) { return 'datetime2'; }
    switch (t) {
        case 'double': return 'float';
        case 'string': return 'nvarchar';
        case 'boolean': return 'bit';
        case 'binary': return 'varbinary';
        default: return t;
    }
}

/** Parse the marker line printed by `buildSparkCode`; `limit` rows were asked for plus one to detect truncation. */
export function parseSparkOutput(text: string, index: number, limit: number): SqlResultSet {
    const line = text.split('\n').find(l => l.startsWith(MARKER));
    if (!line) { throw new Error(`Unexpected Spark output: ${text.slice(0, 200)}`); }
    const payload = JSON.parse(line.slice(MARKER.length)) as { columns: [string, string][]; rows: unknown[][] };
    const truncated = payload.rows.length > limit;
    const rows = truncated ? payload.rows.slice(0, limit) : payload.rows;
    return {
        index,
        columns: payload.columns.map(([name, type]) => ({ name, type: gridType(type), nullable: true })),
        rows,
        totalRows: truncated ? limit + 1 : rows.length,
        truncated,
        ...(payload.columns.length === 0 ? { rowsAffected: 0 } : {}),
    };
}

// ---------------------------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------------------------

export async function runSparkSql(target: SparkTarget, sql: string, maxRows: number, token: vscode.CancellationToken, onProgress: (msg: string) => void): Promise<SqlResultSet[]> {
    const limit = Math.min(maxRows, SPARK_ROW_CAP);
    setStatus('starting…', target);
    try {
        const s = await readySession(target, token, state => {
            if (state !== 'idle') { setStatus(`${state}…`, target); onProgress(`Spark session ${state} on ${target.label} (a cold start takes 1–3 min)…`); }
        });
        const statements = splitQueries(sql).map(q => q.sql).filter(Boolean);
        const sets: SqlResultSet[] = [];
        for (let i = 0; i < statements.length; i++) {
            setStatus(`running ${statements.length > 1 ? `${i + 1}/${statements.length}` : ''}…`, target);
            onProgress(`Running statement ${i + 1} of ${statements.length} on ${target.label}…`);
            const out = await runStatement(s, buildSparkCode(statements[i], limit + 1), token);
            sets.push(parseSparkOutput(out, i, limit));
        }
        markIdle(target);
        return sets;
    } catch (e) {
        if (sessions.has(keyOf(target))) { markIdle(target); } else { setStatus(null); }
        throw e;
    }
}

/** Delete every session this window started. */
export async function stopSparkSessions(): Promise<number> {
    const live = [...sessions.values()];
    sessions.clear();
    if (idleTimer) { clearTimeout(idleTimer); }
    setStatus(null);
    await Promise.all(live.map(s => livy(s.url, 'DELETE').catch(() => undefined)));
    return live.length;
}
