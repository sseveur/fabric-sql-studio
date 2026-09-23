import * as vscode from 'vscode';
import { ConnectionRef, ObjectRef, ObjectRefKey, refKeyCI, refToKey } from './objectRef';

/**
 * Connection profiles live in settings (`fabricSql.connections`), mssql-extension style,
 * so they ride Settings Sync. `activeConnection` is the profile bare queries run against.
 */
export const SETTING_CONNECTIONS = 'fabricSql.connections';
export const SETTING_ACTIVE_CONNECTION = 'fabricSql.activeConnection';
export const SETTING_PINNED_OBJECTS = 'fabricSql.pinned-objects';

interface RawConnection { id?: string; server?: string; database?: string; port?: number; kind?: string }

export function getConnections(): ConnectionRef[] {
    const raw = vscode.workspace.getConfiguration().get<RawConnection[]>(SETTING_CONNECTIONS, []) || [];
    return raw
        .filter(c => c && typeof c.server === 'string' && c.server.trim())
        .map(c => ({
            id: (c.id || `${c.server}/${c.database ?? ''}`).trim(),
            server: c.server!.trim(),
            database: (c.database || '').trim(),
            port: c.port,
            kind: c.kind === 'fabric' || /\.fabric\.microsoft\.com$/i.test(c.server!) ? 'fabric' : 'sqlserver',
        }));
}

export function getConnection(id: string): ConnectionRef | null {
    return getConnections().find(c => c.id === id) ?? null;
}

/** The active profile, falling back to the first one configured. */
export function getActiveConnection(): ConnectionRef | null {
    const all = getConnections();
    if (all.length === 0) { return null; }
    const id = vscode.workspace.getConfiguration().get<string>(SETTING_ACTIVE_CONNECTION, '');
    return all.find(c => c.id === id) ?? all[0];
}

export async function setActiveConnection(id: string): Promise<void> {
    await vscode.workspace.getConfiguration().update(SETTING_ACTIVE_CONNECTION, id, vscode.ConfigurationTarget.Global);
}

export function getPinnedObjectKeys(): ObjectRefKey[] {
    return (vscode.workspace.getConfiguration().get<string[]>(SETTING_PINNED_OBJECTS, []) || []).map(s => s.trim()).filter(Boolean);
}

export function isPinned(ref: ObjectRef): boolean {
    const key = refKeyCI(ref);
    return getPinnedObjectKeys().some(k => k.toLowerCase() === key);
}

export async function pinObject(ref: ObjectRef): Promise<void> {
    if (isPinned(ref)) { return; }
    await vscode.workspace.getConfiguration().update(SETTING_PINNED_OBJECTS, [...getPinnedObjectKeys(), refToKey(ref)], vscode.ConfigurationTarget.Global);
}

export async function unpinObject(ref: ObjectRef): Promise<void> {
    const key = refKeyCI(ref);
    await vscode.workspace.getConfiguration().update(SETTING_PINNED_OBJECTS, getPinnedObjectKeys().filter(k => k.toLowerCase() !== key), vscode.ConfigurationTarget.Global);
}
