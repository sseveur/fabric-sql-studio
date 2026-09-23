import * as vscode from 'vscode';
import { getExtensionUri } from '../extension';
import * as commands from '../commands/ids';
import { currentProfile, getAccountLabel, setAuthMode } from '../services/auth';
import { getNonce, getCspMetaTag } from '../utils/webviewSecurity';

/**
 * Escapes a string for safe embedding in HTML content.
 * Prevents XSS attacks by converting special characters to HTML entities.
 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export class AuthenticationWebviewViewProvider implements vscode.WebviewViewProvider {

    private disposableEvent: vscode.Disposable | null = null;
    public webviewView: vscode.WebviewView | null = null;
    private context: vscode.WebviewViewResolveContext<unknown> | null = null;
    private token: vscode.CancellationToken | null = null;

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>, token: vscode.CancellationToken): Thenable<void> | void {

        this.webviewView = webviewView;
        this.context = context;
        this.token = token;

        webviewView.webview.options = { enableScripts: true };

        if (this.disposableEvent) { this.disposableEvent.dispose(); }
        this.disposableEvent = webviewView.webview.onDidReceiveMessage(this.listenerOnDidReceiveMessage);

        const toolkitUri = this.getUri(webviewView.webview, getExtensionUri(), ['resources', 'toolkit.min.js']);
        const codiconsUri = this.getUri(webviewView.webview, getExtensionUri(), ['resources', 'codicon.css']);
        const nonce = getNonce();
        const cspMetaTag = getCspMetaTag(webviewView.webview, nonce, { allowUnsafeInlineStyles: true });
        const page = (body: string) => this.getHtml(toolkitUri, codiconsUri, nonce, cspMetaTag, body);

        webviewView.webview.html = page(this.renderLoading());

        getAccountLabel()
            .then(account => { webviewView.webview.html = page(this.renderAccount(account)); })
            .catch(error => { webviewView.webview.html = page(this.renderError(error)); });
    }

    private getStyles(): string {
        return `
            <style>
                * { box-sizing: border-box; }
                body {
                    padding: 0 12px 12px 12px;
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                }
                .section { margin-bottom: 16px; }
                .section-title {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .section-title .codicon { font-size: 14px; }
                .account-card {
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-left: 3px solid var(--vscode-charts-green);
                    border-radius: 6px;
                    padding: 12px;
                    margin-bottom: 8px;
                }
                .account-header { display: flex; align-items: center; gap: 10px; }
                .account-avatar {
                    width: 32px; height: 32px; border-radius: 50%;
                    background: var(--vscode-button-secondaryBackground);
                    display: flex; align-items: center; justify-content: center;
                    color: var(--vscode-button-secondaryForeground);
                    flex-shrink: 0;
                }
                .account-info { flex: 1; min-width: 0; }
                .account-email { font-size: 12px; font-weight: 500; word-break: break-all; line-height: 1.3; }
                .account-mode { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
                .account-actions { display: flex; gap: 6px; margin-top: 10px; }
                .account-actions vscode-button { flex: 1; }
                .auth-buttons { display: flex; flex-direction: column; gap: 6px; }
                .auth-button {
                    display: flex; align-items: center; gap: 8px;
                    padding: 8px 12px;
                    background: var(--vscode-button-secondaryBackground);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 6px;
                    color: var(--vscode-button-secondaryForeground);
                    cursor: pointer;
                    font-size: 12px;
                    text-align: left;
                }
                .auth-button:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                    border-color: var(--vscode-focusBorder);
                }
                .auth-button .codicon { font-size: 16px; opacity: 0.8; }
                .auth-button-text { flex: 1; }
                .auth-button-title { font-weight: 500; }
                .auth-button-desc { font-size: 10px; opacity: 0.7; margin-top: 2px; }
                .footer {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    padding-top: 12px;
                    border-top: 1px solid var(--vscode-widget-border);
                }
                .footer a { color: var(--vscode-textLink-foreground); text-decoration: none; }
                .footer a:hover { text-decoration: underline; }
                .empty-state { text-align: center; padding: 20px; color: var(--vscode-descriptionForeground); }
                .empty-state .codicon { font-size: 32px; margin-bottom: 8px; opacity: 0.5; }
                .error { color: var(--vscode-errorForeground); }
                @keyframes spin { to { transform: rotate(360deg); } }
                .loading-spinner { animation: spin 1s linear infinite; display: inline-block; }
            </style>
        `;
    }

    private renderLoading(): string {
        return `
            <div class="section">
                <div class="empty-state">
                    <div class="codicon codicon-sync loading-spinner"></div>
                    <div>Checking sign-in…</div>
                </div>
            </div>
            ${this.renderAddSection()}`;
    }

    private renderError(error: any): string {
        const message = String(error?.message ?? error ?? 'Unknown error');
        return `
            <div class="section">
                <div class="empty-state error">
                    <div class="codicon codicon-error"></div>
                    <div style="margin-bottom: 8px;">Authentication Error</div>
                    <div style="font-size: 11px; opacity: 0.8;">${escapeHtml(message)}</div>
                </div>
            </div>
            ${this.renderAddSection()}`;
    }

    private renderAccount(account: string | null): string {
        const mode = currentProfile().mode;
        const modeLabel = mode === 'azure-cli' ? 'Azure CLI (az login)' : 'Microsoft account';

        const card = account
            ? `
            <div class="account-card">
                <div class="account-header">
                    <div class="account-avatar"><span class="codicon codicon-account"></span></div>
                    <div class="account-info">
                        <div class="account-email">${escapeHtml(account)}</div>
                        <div class="account-mode">${escapeHtml(modeLabel)}</div>
                    </div>
                </div>
                <div class="account-actions">
                    <vscode-button appearance="secondary" data-command="sign_out">
                        <span class="codicon codicon-sign-out"></span>&nbsp;Sign out
                    </vscode-button>
                </div>
            </div>`
            : `
            <div class="empty-state">
                <div class="codicon codicon-account"></div>
                <div>Not signed in</div>
            </div>`;

        return `
            <div class="section">
                <div class="section-title">
                    <span class="codicon codicon-verified-filled"></span>
                    Signed in
                </div>
                ${card}
            </div>
            ${this.renderAddSection()}`;
    }

    private renderAddSection(): string {
        return `
            <div class="section">
                <div class="section-title">
                    <span class="codicon codicon-add"></span>
                    Sign in
                </div>
                <div class="auth-buttons">
                    <div class="auth-button" data-command="sign_in">
                        <span class="codicon codicon-sign-in"></span>
                        <div class="auth-button-text">
                            <div class="auth-button-title">Sign in with Microsoft</div>
                            <div class="auth-button-desc">Entra ID via the VS Code Accounts menu</div>
                        </div>
                    </div>
                    <div class="auth-button" data-command="use_cli">
                        <span class="codicon codicon-terminal"></span>
                        <div class="auth-button-text">
                            <div class="auth-button-title">Use Azure CLI login</div>
                            <div class="auth-button-desc">Reuse an existing <code>az login</code> session</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="footer">
                <p>Signing out of a Microsoft account is done from the VS Code <b>Accounts</b> menu (bottom left).</p>
                <p>Wrong tenant? Set <a href="#" data-command="open_settings">fabricSql.tenantId</a>.</p>
            </div>`;
    }

    private getHtml(toolkitUri: vscode.Uri, codiconsUri: vscode.Uri, nonce: string, cspMetaTag: string, body: string): string {
        return `<!DOCTYPE html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    ${cspMetaTag}
                    <script nonce="${nonce}" type="module" src="${toolkitUri}"></script>
                    <link rel="stylesheet" href="${codiconsUri}">
                    ${this.getStyles()}
                </head>
                <body>
                    ${body}
                    <script nonce="${nonce}">
                        const vscode = acquireVsCodeApi();
                        document.addEventListener('click', (e) => {
                            const target = e.target.closest('[data-command]');
                            if (target) {
                                e.preventDefault();
                                vscode.postMessage(target.dataset.command);
                            }
                        });
                    </script>
                </body>
            </html>`;
    }

    private getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
        return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
    }

    listenerOnDidReceiveMessage(message: any): void {
        switch (message) {
            case 'sign_in':
                setAuthMode('entra-interactive')
                    .then(() => vscode.commands.executeCommand(commands.COMMAND_USER_LOGIN));
                break;
            case 'use_cli':
                setAuthMode('azure-cli')
                    .then(() => vscode.commands.executeCommand(commands.COMMAND_USER_LOGIN));
                break;
            case 'sign_out':
                vscode.commands.executeCommand(commands.COMMAND_REVOKE_SESSION);
                break;
            case 'open_settings':
                vscode.commands.executeCommand('workbench.action.openSettings', 'fabricSql.tenantId');
                break;
            default:
                console.error(`Unexpected message "${message}"`);
        }
    }

    refresh() {
        if (this.webviewView !== null && this.context !== null && this.token !== null) {
            this.resolveWebviewView(this.webviewView, this.context, this.token);
        }
    }
}
