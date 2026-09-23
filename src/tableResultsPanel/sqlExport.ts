import * as vscode from 'vscode';
import * as fs from 'fs';
import { createArrayCsvStringifier } from 'csv-writer';
import { getResultSet } from '../services/sqlServerClient';
import { SqlResultSet } from './resultContract';

export type ExportKind = 'csv' | 'jsonl' | 'clipboard';

/**
 * Exports a result set the host already holds (rows are materialised up to `maxRows`, so no
 * re-query). CSV / JSONL go through a save dialog; clipboard copies CSV up to
 * `clipboardSizeLimitKb`.
 */
export async function exportSqlResult(kind: ExportKind, resultId: string, setIndex: number): Promise<void> {
    let set: SqlResultSet;
    try { set = getResultSet(resultId, setIndex); }
    catch (e: any) { vscode.window.showErrorMessage(e.message); return; }

    if (kind === 'clipboard') { return copyCsv(set); }

    const ext = kind === 'csv' ? 'csv' : 'jsonl';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
        title: 'Save export',
        filters: { [ext]: [ext] },
        defaultUri: folder ? vscode.Uri.joinPath(folder, `result_${stamp}.${ext}`) : undefined,
    });
    if (!uri) { return; }

    try {
        fs.writeFileSync(uri.fsPath, kind === 'csv' ? toCsv(set) : toJsonl(set));
        const note = set.truncated ? ` (first ${set.rows.length.toLocaleString()} rows only — raise fabricSql.maxRows for more)` : '';
        vscode.window.showInformationMessage(`Saved ${set.rows.length.toLocaleString()} rows to ${uri.fsPath}${note}`);
    } catch (e: any) {
        vscode.window.showErrorMessage(`Export failed: ${e.message}`);
    }
}

export function toCsv(set: SqlResultSet): string {
    const s = createArrayCsvStringifier({ header: set.columns.map(c => c.name) });
    return s.getHeaderString() + s.stringifyRecords(set.rows.map(r => r.map(cell)));
}

export function toJsonl(set: SqlResultSet): string {
    const names = set.columns.map(c => c.name);
    return set.rows.map(r => JSON.stringify(Object.fromEntries(names.map((n, i) => [n, r[i]])))).join('\n') + (set.rows.length ? '\n' : '');
}

function cell(v: unknown): string {
    if (v === null || v === undefined) { return ''; }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

async function copyCsv(set: SqlResultSet): Promise<void> {
    const limitKb = vscode.workspace.getConfiguration('fabricSql').get<number>('clipboardSizeLimitKb', 1024);
    const limit = limitKb * 1024;
    const s = createArrayCsvStringifier({ header: set.columns.map(c => c.name) });
    let text = s.getHeaderString() ?? '';
    let size = Buffer.byteLength(text);
    let copied = 0;
    for (const r of set.rows) {
        const line = s.stringifyRecords([r.map(cell)]);
        size += Buffer.byteLength(line);
        if (size > limit) { break; }
        text += line;
        copied++;
    }
    if (copied < set.rows.length) {
        const choice = await vscode.window.showWarningMessage(
            `Data exceeds the ${limitKb} KB clipboard limit (${copied.toLocaleString()} of ${set.rows.length.toLocaleString()} rows fit).`, 'Copy truncated', 'Cancel');
        if (choice !== 'Copy truncated') { return; }
    }
    await vscode.env.clipboard.writeText(text.replace(/[\r\n]+$/, ''));
    vscode.window.showInformationMessage(`Copied ${copied.toLocaleString()} rows as CSV`);
}
