import { JobHistoryEntry } from '../services/jobHistoryService';

/**
 * Request Details webview HTML: a key/value table plus the statement text. Pure string
 * builder, everything escaped, NO scripts — the panel ships with
 * `default-src 'none'; style-src 'unsafe-inline'`.
 */
export function renderRequestDetailsHtml(e: JobHistoryEntry): string {
    const rows = [['Connection', e.jobReference.projectId], ...e.details]
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px 16px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); margin: 18px 0 8px; }
  table.kv td { padding: 3px 12px 3px 0; vertical-align: top; }
  table.kv td:first-child { color: var(--vscode-descriptionForeground); white-space: nowrap; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 4px; overflow: auto; white-space: pre-wrap; }
  .err { color: var(--vscode-errorForeground); }
</style></head><body>
<h2>Request</h2><table class="kv">${rows}</table>
${e.errorMessage ? `<h2 class="err">Error</h2><p class="err">${esc(e.errorMessage)}</p>` : ''}
<h2>Statement</h2><pre>${esc(e.query ?? '—')}</pre>
</body></html>`;
}

function esc(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
