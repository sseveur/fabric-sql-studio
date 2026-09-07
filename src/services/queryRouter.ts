import { collectTableIdentifiers, parse, splitChain, textAt } from '../language/tsqlParser';
import { getActiveConnection, getConnections } from './connections';
import { ConnectionRef } from './objectRef';
import { clientFor } from './sqlServerClient';

/**
 * Picks the connection a batch should run on from the databases it names.
 *
 * `[db].[schema].[table]` is resolved by the *server* in T-SQL, not by the client, and Fabric has
 * no cross-workspace three-part names — so a query that names a database living on another
 * connection can only work if we send it there. Rules:
 *   1. no three-part names, or every named database exists on the active connection → active
 *   2. every named database exists on another connection → that one (routed); when several
 *      qualify, the one whose own database is named wins, else the first
 *   3. otherwise → active, and the server's 208 names the connection in the error
 */
export interface RouteDecision {
    conn: ConnectionRef;
    routed: boolean;
    databases: string[];
}

export function databasesNamedIn(sql: string): string[] {
    const out = new Set<string>();
    for (const ti of collectTableIdentifiers(parse(sql).items)) {
        const chain = ti.items.find(c => c.item_type.startsWith('TableIdentifier') && c.item_type !== 'TableIdentifierAlias');
        if (!chain) { continue; }
        const parts = splitChain(textAt(sql, chain.range));
        if (parts.length >= 3 && parts[parts.length - 3]) { out.add(parts[parts.length - 3].toLowerCase()); }
    }
    return [...out];
}

async function hasAll(conn: ConnectionRef, databases: string[]): Promise<boolean> {
    try {
        const known = new Set((await clientFor(conn).databases()).map(d => d.toLowerCase()));
        return databases.every(d => known.has(d));
    } catch {
        return false;
    }
}

/** The connection that has `database`: active first, then the only other one that does. */
export async function connectionForDatabase(database: string): Promise<ConnectionRef | null> {
    const active = getActiveConnection();
    if (!active) { return null; }
    const wanted = [database.toLowerCase()];
    if (await hasAll(active, wanted)) { return active; }
    const matches: ConnectionRef[] = [];
    for (const c of getConnections().filter(c => c.id !== active.id)) {
        if (await hasAll(c, wanted)) { matches.push(c); }
    }
    return pickMatch(matches, wanted) ?? active;
}

/**
 * Several profiles can point at the same Fabric workspace (every warehouse there sees every
 * database), so more than one match is normal. Prefer the profile whose own database is one of
 * the named ones; otherwise the first — they share the endpoint.
 */
function pickMatch(matches: ConnectionRef[], databases: string[]): ConnectionRef | null {
    if (matches.length === 0) { return null; }
    return matches.find(c => databases.includes(c.database.toLowerCase())) ?? matches[0];
}

export async function pickConnectionFor(sql: string): Promise<RouteDecision | null> {
    const active = getActiveConnection();
    if (!active) { return null; }

    const databases = databasesNamedIn(sql);
    if (databases.length === 0 || await hasAll(active, databases)) {
        return { conn: active, routed: false, databases };
    }

    const others = getConnections().filter(c => c.id !== active.id);
    const matches: ConnectionRef[] = [];
    for (const c of others) {
        if (await hasAll(c, databases)) { matches.push(c); }
    }
    const target = pickMatch(matches, databases);
    return target ? { conn: target, routed: true, databases } : { conn: active, routed: false, databases };
}
