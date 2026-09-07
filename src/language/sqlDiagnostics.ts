import * as vscode from 'vscode';
import { getStatusBarInfo } from '../extension';

/**
 * Server-side errors from the last run, mapped back onto the editor line the driver reports.
 * There is no pre-flight parse: T-SQL has no dry run, so the diagnostic appears after Ctrl+Enter
 * and clears on the next successful run of that document.
 */
const collection = vscode.languages.createDiagnosticCollection('bigquery-studio-sql');

export function clearSqlDiagnostics(uri: vscode.Uri | undefined): void {
    if (uri) { collection.delete(uri); }
}

export function reportSqlError(uri: vscode.Uri | undefined, error: any): void {
    if (!uri) { return; }
    const message: string = error?.message ?? String(error);
    // tedious RequestError: lineNumber is 1-based within the batch we sent (the whole document).
    const line = Math.max(0, (Number(error?.lineNumber) || 1) - 1);
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const range = doc && line < doc.lineCount ? doc.lineAt(line).range : new vscode.Range(line, 0, line, 1);
    const d = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
    d.source = error?.number ? `SQL ${error.number}` : 'SQL';
    collection.set(uri, [d]);
}

export function showQueryStatus(text: string, tooltip?: string): void {
    const bar = getStatusBarInfo();
    if (!bar) { return; }
    bar.text = text;
    bar.tooltip = tooltip;
    bar.show();
}
