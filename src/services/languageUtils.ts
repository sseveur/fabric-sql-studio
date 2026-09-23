import * as vscode from 'vscode';

/**
 * Checks if a language ID is a T-SQL language.
 * Returns true for 'fsql' (always) and 'sql' (if the setting is enabled).
 */
export function isFabricSqlLanguage(languageId: string): boolean {
    if (languageId === 'fsql') {
        return true;
    }
    if (languageId === 'sql') {
        const config = vscode.workspace.getConfiguration('fabricSql');
        return config.get<boolean>('associateSqlFiles', false);
    }
    return false;
}
