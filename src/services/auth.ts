import * as vscode from 'vscode';
import { AzureCliCredential } from '@azure/identity';

/**
 * Entra ID token acquisition for the SQL Server / Fabric targets.
 *
 * Two modes, picked by the `authMode` setting:
 *  - `entra-interactive`: VS Code's built-in Microsoft account provider. VS Code owns the
 *    browser flow, the token cache and refresh; the Accounts menu is the sign-out UI.
 *    Tenant is injected as a `VSCODE_TENANT:<id>` pseudo-scope (same trick vscode-mssql uses).
 *  - `azure-cli`: borrow the `az login` session via @azure/identity. No sign-in UI at all.
 *
 * Tokens are per-audience, so callers pass the scope they need. Never log the token itself.
 */
export type AuthMode = 'entra-interactive' | 'azure-cli';

export const SCOPE_TDS = 'https://database.windows.net/.default';
export const SCOPE_FABRIC = 'https://api.fabric.microsoft.com/.default';

const MICROSOFT_PROVIDER = 'microsoft';
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export interface AuthProfile {
    mode: AuthMode;
    tenantId?: string;
}

export interface TokenInfo {
    token: string;
    /** epoch ms */
    expiresOn: number;
    /** UPN / app id for display; never the token. */
    account: string | null;
}

const cache = new Map<string, TokenInfo>();

export function currentProfile(): AuthProfile {
    const cfg = vscode.workspace.getConfiguration('vscode-bigquery');
    const mode = cfg.get<AuthMode>('authMode', 'entra-interactive');
    const tenantId = (cfg.get<string>('tenantId', '') || '').trim() || undefined;
    return { mode, tenantId };
}

export async function setAuthMode(mode: AuthMode): Promise<void> {
    cache.clear();
    await vscode.workspace.getConfiguration('vscode-bigquery')
        .update('authMode', mode, vscode.ConfigurationTarget.Global);
}

/**
 * Get a token for `scope`. With `interactive: false` it never prompts (returns null when
 * there is no session). With `interactive: true` VS Code may open the sign-in flow.
 */
export async function getAccessToken(scope: string, interactive = false): Promise<TokenInfo | null> {
    const profile = currentProfile();
    const key = `${profile.mode}|${profile.tenantId ?? ''}|${scope}`;
    const hit = cache.get(key);
    if (hit && hit.expiresOn - EXPIRY_SKEW_MS > Date.now()) {
        return hit;
    }

    const info = profile.mode === 'azure-cli'
        ? await fromAzureCli(profile, scope)
        : await fromVsCodeAccount(profile, scope, interactive);

    if (info) { cache.set(key, info); }
    return info;
}

async function fromVsCodeAccount(profile: AuthProfile, scope: string, interactive: boolean): Promise<TokenInfo | null> {
    const scopes = [scope];
    if (profile.tenantId) { scopes.push(`VSCODE_TENANT:${profile.tenantId}`); }

    const session = interactive
        ? await vscode.authentication.getSession(MICROSOFT_PROVIDER, scopes, { createIfNone: true })
        : await vscode.authentication.getSession(MICROSOFT_PROVIDER, scopes, { silent: true });
    if (!session) { return null; }

    return {
        token: session.accessToken,
        expiresOn: jwtExpiryMs(session.accessToken) ?? Date.now() + 55 * 60 * 1000,
        account: session.account.label,
    };
}

async function fromAzureCli(profile: AuthProfile, scope: string): Promise<TokenInfo | null> {
    const cred = new AzureCliCredential(profile.tenantId ? { tenantId: profile.tenantId } : undefined);
    const t = await cred.getToken(scope);
    if (!t) { return null; }
    const claims = jwtClaims(t.token);
    return {
        token: t.token,
        expiresOn: t.expiresOnTimestamp,
        account: (claims?.upn ?? claims?.preferred_username ?? claims?.appid ?? null) as string | null,
    };
}

/** Prompt if needed; returns the account label or null if the user cancelled. */
export async function signIn(): Promise<string | null> {
    cache.clear();
    const info = await getAccessToken(SCOPE_TDS, true);
    return info?.account ?? null;
}

/**
 * Forget cached tokens and the preferred account. VS Code has no API to revoke a built-in
 * session — the user does that from the Accounts menu — so we point them there.
 */
export async function signOut(): Promise<void> {
    cache.clear();
    if (currentProfile().mode === 'entra-interactive') {
        await vscode.authentication.getSession(MICROSOFT_PROVIDER, [SCOPE_TDS], { clearSessionPreference: true, silent: true });
    }
}

/** Who are we signed in as, without prompting. */
export async function getAccountLabel(): Promise<string | null> {
    try {
        const info = await getAccessToken(SCOPE_TDS, false);
        return info?.account ?? null;
    } catch {
        return null;
    }
}

/** Non-secret claims for diagnostics: audience, tenant, expiry, account. */
export function describeToken(info: TokenInfo): Record<string, string> {
    const c = jwtClaims(info.token) ?? {};
    return {
        account: info.account ?? '(unknown)',
        audience: String(c.aud ?? '(unknown)'),
        tenant: String(c.tid ?? '(unknown)'),
        expires: new Date(info.expiresOn).toISOString(),
    };
}

function jwtClaims(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length < 2) { return null; }
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function jwtExpiryMs(token: string): number | null {
    const exp = jwtClaims(token)?.exp;
    return typeof exp === 'number' ? exp * 1000 : null;
}
