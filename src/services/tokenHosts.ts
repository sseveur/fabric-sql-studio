import * as vscode from 'vscode';

/**
 * Where the Entra SQL token may go. A connection profile can come from a folder's
 * .vscode/settings.json, so the token is only sent without asking to Microsoft-run SQL hosts;
 * any other server (on-prem SQL Server with Entra, a typo, a hostile profile) needs a one-time
 * Allow, remembered in this machine's globalState — never in settings a workspace can write.
 */

const MICROSOFT_SQL_SUFFIXES = [
    '.database.windows.net',        // Azure SQL Database / Managed Instance
    '.fabric.microsoft.com',        // Fabric Warehouse, Lakehouse SQL endpoint, SQL database
    '.pbidedicated.windows.net',    // Fabric / Power BI capacity endpoints
    '.sql.azuresynapse.net',        // Synapse
    '.database.usgovcloudapi.net',  // Azure Government
    '.database.chinacloudapi.cn',   // Azure China
];

const STORAGE_KEY = 'fabric-sql-approved-token-hosts';

/** Host part of an mssql `server` value: lowercased, without `tcp:`, `,port`, `\instance` or a trailing dot. */
export function normalizeHost(server: string): string {
    return server.trim().toLowerCase()
        .replace(/^tcp:/, '')
        .split(/[\\,]/)[0]
        .replace(/\.$/, '');
}

export function isMicrosoftSqlHost(server: string): boolean {
    const host = normalizeHost(server);
    return MICROSOFT_SQL_SUFFIXES.some(s => host.endsWith(s) && host.length > s.length);
}

let globalState: vscode.Memento | null = null;
const pending = new Map<string, Promise<void>>();

export function initTokenHosts(state: vscode.Memento): void {
    globalState = state;
}

/** Resolves when the token may be sent to `server`; throws if the user declines. */
export function ensureTokenHostAllowed(server: string): Promise<void> {
    if (isMicrosoftSqlHost(server)) { return Promise.resolve(); }
    const host = normalizeHost(server);
    if ((globalState?.get<string[]>(STORAGE_KEY) ?? []).includes(host)) { return Promise.resolve(); }

    // Parallel queries / tree loads to the same host share one prompt
    let ask = pending.get(host);
    if (!ask) {
        ask = askToAllow(host).finally(() => pending.delete(host));
        pending.set(host, ask);
    }
    return ask;
}

async function askToAllow(host: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
        `Send your Microsoft sign-in to ${host}?`,
        {
            modal: true,
            detail: `${host} is not a Microsoft-hosted SQL server. Signing in hands it a token that can query ` +
                `your Fabric and Azure SQL data as you for about an hour. Only allow servers you run or trust. ` +
                `Your answer is remembered on this machine.`,
        },
        'Allow');
    if (choice !== 'Allow') {
        throw new Error(`Sign-in not sent to ${host}: server not allowed.`);
    }
    const approved = globalState?.get<string[]>(STORAGE_KEY) ?? [];
    await globalState?.update(STORAGE_KEY, [...approved, host]);
}
