import * as vscode from 'vscode';

/**
 * Scans globalState, reports each key's size, and offers to wipe.
 * Falls back to a known-keys list when Memento.keys() is empty/unsupported.
 */
const KNOWN_GLOBAL_STATE_KEYS = [
	'fabric-sql-table-index',
	'queryResultsMapping',
	'queryResultsChartMapping',
	'fabric-sql-query-history',
];

export const commandClearExtensionCache = function (globalState: vscode.Memento) {
	return async function () {
		try {
			let keys: readonly string[] = [];
			try { keys = globalState.keys() || []; } catch { keys = []; }
			if (!keys.length) { keys = KNOWN_GLOBAL_STATE_KEYS; }
			const merged = Array.from(new Set([...keys, ...KNOWN_GLOBAL_STATE_KEYS]));

			const sizes: Array<{ key: string; bytes: number }> = [];
			for (const key of merged) {
				try {
					const value = globalState.get(key);
					if (value === undefined) { continue; }
					sizes.push({ key, bytes: JSON.stringify(value).length });
				} catch { /* skip */ }
			}
			sizes.sort((a, b) => b.bytes - a.bytes);
			const report = sizes.length
				? sizes.map(s => `${s.key}: ${(s.bytes / 1024 / 1024).toFixed(2)} MB`).join('\n')
				: '(no enumerable keys found)';
			const total = sizes.reduce((acc, s) => acc + s.bytes, 0);
			const choice = await vscode.window.showWarningMessage(
				`Fabric SQL extension globalState: ${(total / 1024 / 1024).toFixed(1)} MB across ${sizes.length} enumerable keys.\n\n${report}\n\nWipe ALL ${sizes.length} keys?`,
				{ modal: true },
				'Wipe All', 'Cancel'
			);
			if (choice === 'Wipe All') {
				for (const entry of sizes) {
					await globalState.update(entry.key, undefined);
				}
				vscode.window.showInformationMessage(`Cleared ${sizes.length} key(s), ${(total / 1024 / 1024).toFixed(1)} MB freed. Reload window.`);
			}
		} catch (err) {
			vscode.window.showErrorMessage(`Clear cache failed: ${(err as any)?.message || err}`);
		}
	};
};
