import * as vscode from 'vscode';
import { getExtensionUri } from '../extension';
import { COMMAND_DOWNLOAD_CSV, COMMAND_DOWNLOAD_JSONL, COMMAND_COPY_CLIPBOARD } from '../extensionCommands';
import { SqlPageRequest, SqlPageResponse, GridHostMessage } from './resultContract';
import { getResultPage } from '../services/sqlServerClient';

const GRID_COLOR_KEY_TO_VAR: Record<string, string> = {
    number: '--bq-color-number',
    boolean: '--bq-color-boolean',
    timestamp: '--bq-color-timestamp',
    struct: '--bq-color-struct',
    bytes: '--bq-color-bytes',
    string: '--bq-color-string',
    null: '--bq-color-null',
};

/**
 * Reads the `vscode-bigquery.gridColors` setting and returns sanitized `{ cssVar: value }` overrides
 * (allowlist regex + 80-char cap). Shared by the results-panel webview and the notebook renderer so
 * both honor the same per-type cell colors.
 */
export function sanitizedGridColorVars(): Record<string, string> {
    const cfg = vscode.workspace.getConfiguration('vscode-bigquery').get<Record<string, string>>('gridColors', {});
    const out: Record<string, string> = {};
    if (!cfg || typeof cfg !== 'object') { return out; }
    for (const [k, v] of Object.entries(cfg)) {
        const cssVar = GRID_COLOR_KEY_TO_VAR[k];
        if (!cssVar || typeof v !== 'string') { continue; }
        const raw = v.trim();
        if (!raw || raw.length > 80) { continue; }
        if (!/^[A-Za-z0-9 ,.()%#\-]+$/.test(raw)) { continue; }
        out[cssVar] = raw;
    }
    return out;
}

export class ResultsGridRender {

    private webViewPanel: vscode.WebviewPanel;
    private disposed = false;

    constructor(webViewPanel: vscode.WebviewPanel) {
        this.webViewPanel = webViewPanel;
        webViewPanel.onDidDispose(() => { this.disposed = true; });
    }

    public static executeCommand(c: any) {
        if ((c as any).command) {
            const command = (c as any).command;
            const data = { command, resultId: (c as any).resultId, setIndex: (c as any).setIndex };

            switch (command) {
                case "download_csv": { vscode.commands.executeCommand(COMMAND_DOWNLOAD_CSV, data); break; }
                case "download_jsonl": { vscode.commands.executeCommand(COMMAND_DOWNLOAD_JSONL, data); break; }
                case "copy_to_clipboard": { vscode.commands.executeCommand(COMMAND_COPY_CLIPBOARD, data); break; }
            }
        }
    }

    private buildGridColorOverrides(): string {
        const lines = Object.entries(sanitizedGridColorVars()).map(([k, v]) => `${k}: ${v};`);
        return lines.length ? `:root { ${lines.join(' ')} }` : '';
    }

    private buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const gridJs = this.getUri(webview, extensionUri, ['resources', 'grid-v2.js']);
        const gridCss = this.getUri(webview, extensionUri, ['resources', 'grid-v2.css']);
        const colorOverrides = this.buildGridColorOverrides();
        const nonce = this.makeNonce();
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource} 'nonce-${nonce}'`,
            `script-src ${webview.cspSource}`,
            `connect-src 'none'`,
            `img-src ${webview.cspSource} data:`,
            `font-src ${webview.cspSource}`,
        ].join('; ');
        return `<!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="${csp}">
                <link rel="stylesheet" href="${gridCss}">
                <style nonce="${nonce}">html, body, #q1 { height: 100%; overflow: hidden; }</style>
                ${colorOverrides ? `<style nonce="${nonce}">${colorOverrides}</style>` : ''}
            </head>
            <body>
                <div id="q1"></div>
                <script src="${gridJs}"></script>
            </body>
        </html>`;
    }

    private makeNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let s = '';
        for (let i = 0; i < 32; i++) { s += chars[Math.floor(Math.random() * chars.length)]; }
        return s;
    }

    public render1(): Promise<boolean> {

        const extensionUri = getExtensionUri();

        return new Promise((resolve, reject) => {

            const timer = setTimeout(() => {
                reject(null);
            }, 10 * 1000);

            this.webViewPanel.webview.onDidReceiveMessage(c => {
                if ((c as any).command === 'load_complete') {
                    clearTimeout(timer);
                    resolve(true);
                } else if ((c as any).command === 'fetch_page') {
                    this.answerPage(c as SqlPageRequest);
                } else {
                    ResultsGridRender.executeCommand(c);
                }
            });

            this.webViewPanel.webview.html = this.buildHtml(this.webViewPanel.webview, extensionUri);
        });
    }

    public render2() {

        const extensionUri = getExtensionUri();

        this.webViewPanel.webview.onDidReceiveMessage(c => {
            if ((c as any).command === 'fetch_page') {
                this.answerPage(c as SqlPageRequest);
            } else if ((c as any).command !== 'load_complete') {
                ResultsGridRender.executeCommand(c);
            }
        });

        this.webViewPanel.webview.html = this.buildHtml(this.webViewPanel.webview, extensionUri);
    }

    /** Resolves false (instead of throwing) when the user closed the panel before the query returned. */
    public postMessage(message: GridHostMessage): Thenable<boolean> {
        if (this.disposed) { return Promise.resolve(false); }
        return this.webViewPanel.webview.postMessage(message);
    }

    private answerPage(req: SqlPageRequest): void {
        let reply: SqlPageResponse;
        try {
            reply = { requestType: 'sql_page', requestId: req.requestId, rows: getResultPage(req.resultId, req.setIndex, req.startIndex, req.pageSize) };
        } catch (e: any) {
            reply = { requestType: 'sql_page', requestId: req.requestId, error: String(e?.message ?? e) };
        }
        if (!this.disposed) { this.webViewPanel.webview.postMessage(reply); }
    }

    private getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
        return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
    }

    reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void {
        this.webViewPanel.reveal(viewColumn, preserveFocus);
    }

}
