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
 *   2. every named database exists on exactly one other connection → that one (routed)
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
    if (matches.length === 1) { return { conn: matches[0], routed: true, databases }; }
    return { conn: active, routed: false, databases };
}
