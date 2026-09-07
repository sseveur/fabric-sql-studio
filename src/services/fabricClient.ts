import { getAccessToken, SCOPE_FABRIC } from './auth';

/**
 * Minimal Fabric REST client: enough to turn "which workspace, which warehouse / lakehouse" into
 * a TDS host + database for a connection profile. Everything else about the item is browsed
 * through the SQL endpoint's catalog views, not this API.
 *
 * Rate limit is 50 calls/API/user/min, so callers list on demand (QuickPick), never eagerly.
 */
const BASE = 'https://api.fabric.microsoft.com/v1';

export interface FabricWorkspace {
    id: string;
    displayName: string;
    type: string;
    capacityId?: string;
}

export interface FabricSqlItem {
    id: string;
    workspaceId: string;
    displayName: string;
    type: 'Warehouse' | 'Lakehouse' | 'SQLDatabase';
    /** TDS host, no port. */
    server: string;
    /** Initial catalog to connect with. */
    database: string;
    /** Set when the SQL endpoint is not (yet) usable. */
    unavailableReason?: string;
}

interface Page<T> { value: T[]; continuationToken?: string }

async function fabricGet<T>(path: string): Promise<T[]> {
    const tokenInfo = await getAccessToken(SCOPE_FABRIC, true);
    if (!tokenInfo) { throw new Error('Not signed in. Use the Authentication view to sign in first.'); }

    const out: T[] = [];
    let url: string | null = `${BASE}/${path}`;
    while (url) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenInfo.token}` } });
        if (res.status === 429) {
            const wait = Number(res.headers.get('Retry-After') ?? '5');
            await new Promise(r => setTimeout(r, Math.min(wait, 30) * 1000));
            continue;
        }
        if (!res.ok) {
            let detail = res.statusText;
            try { detail = (await res.json())?.message ?? detail; } catch { /* keep statusText */ }
            throw new Error(`Fabric API ${res.status} on ${path}: ${detail}`);
        }
        const page = (await res.json()) as Page<T>;
        out.push(...(page.value ?? []));
        url = page.continuationToken
            ? `${BASE}/${path}${path.includes('?') ? '&' : '?'}continuationToken=${encodeURIComponent(page.continuationToken)}`
            : null;
    }
    return out;
}

export async function listWorkspaces(): Promise<FabricWorkspace[]> {
    const ws = await fabricGet<FabricWorkspace>('workspaces');
    return ws.filter(w => w.type !== 'AdminWorkspace').sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Warehouses, lakehouse SQL endpoints and Fabric SQL databases in one list. */
export async function listSqlItems(workspaceId: string): Promise<FabricSqlItem[]> {
    type WH = { id: string; displayName: string; properties?: { connectionString?: string } };
    type LH = { id: string; displayName: string; properties?: { sqlEndpointProperties?: { connectionString?: string; provisioningStatus?: string } } };
    type DB = { id: string; displayName: string; properties?: { serverFqdn?: string; databaseName?: string } };

    const [warehouses, lakehouses, databases] = await Promise.all([
        fabricGet<WH>(`workspaces/${workspaceId}/warehouses`).catch(() => [] as WH[]),
        fabricGet<LH>(`workspaces/${workspaceId}/lakehouses`).catch(() => [] as LH[]),
        fabricGet<DB>(`workspaces/${workspaceId}/sqlDatabases`).catch(() => [] as DB[]),
    ]);

    const items: FabricSqlItem[] = [
        ...warehouses.map((w): FabricSqlItem => ({
            id: w.id, workspaceId, displayName: w.displayName, type: 'Warehouse',
            server: w.properties?.connectionString ?? '', database: w.displayName,
            unavailableReason: w.properties?.connectionString ? undefined : 'no SQL connection string',
        })),
        ...lakehouses.map((l): FabricSqlItem => {
            const ep = l.properties?.sqlEndpointProperties;
            return {
                id: l.id, workspaceId, displayName: l.displayName, type: 'Lakehouse',
                server: ep?.connectionString ?? '', database: l.displayName,
                unavailableReason: ep?.provisioningStatus === 'Success' && ep.connectionString ? undefined : `SQL endpoint ${ep?.provisioningStatus ?? 'missing'}`,
            };
        }),
        ...databases.map((d): FabricSqlItem => ({
            id: d.id, workspaceId, displayName: d.displayName, type: 'SQLDatabase',
            server: (d.properties?.serverFqdn ?? '').split(',')[0], database: d.properties?.databaseName ?? d.displayName,
            unavailableReason: d.properties?.serverFqdn ? undefined : 'no server FQDN',
        })),
    ];
    return items.sort((a, b) => a.type.localeCompare(b.type) || a.displayName.localeCompare(b.displayName));
}
