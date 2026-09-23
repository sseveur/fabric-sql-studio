import * as vscode from 'vscode';
import { formatFabricSqlSQL, formatErrorSummary } from './fsqlFormatter';

/**
 * Bridges the existing SQL formatter into VS Code's standard formatting API so
 * that "Format Document" (Shift+Alt+F), the editor context menu entry, and
 * editor.formatOnSave all work — not just the fabricSql.format-query
 * command. Same formatting logic and settings as the command (see #12).
 */
export class FsqlFormattingProvider implements vscode.DocumentFormattingEditProvider {

    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const text = document.getText();

        let formatted: string;
        try {
            formatted = formatFabricSqlSQL(text);
        } catch (error: any) {
            vscode.window.showErrorMessage(formatErrorSummary(error));
            return [];
        }

        if (formatted === text) {
            return [];
        }

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length)
        );

        return [vscode.TextEdit.replace(fullRange, formatted)];
    }
}
