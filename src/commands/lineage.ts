import * as vscode from 'vscode';
import { buildMultiQueryLineage } from '../services/lineageGraph';
import { showMultiLineagePanel } from '../lineage/lineageWebviewProvider';

// Data Lineage
export const commandShowLineage = function (context: vscode.ExtensionContext) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor with SQL query');
		return;
	}

	const text = editor.document.getText();
	if (!text.trim()) {
		vscode.window.showErrorMessage('No SQL query in the active editor');
		return;
	}

	try {
		const result = buildMultiQueryLineage(text);
		const queriesWithLineage = result.queries.filter(q => q.graph.nodes.length > 0);

		if (queriesWithLineage.length === 0) {
			vscode.window.showInformationMessage('No table references found in any queries');
			return;
		}

		showMultiLineagePanel(result, context);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to analyze lineage: ${error.message}`);
	}
};

// Data Lineage for Selection
export const commandShowLineageSelection = function (context: vscode.ExtensionContext) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor with SQL query');
		return;
	}

	if (editor.selection.isEmpty) {
		vscode.window.showErrorMessage('No text selected. Please select a SQL query.');
		return;
	}

	const text = editor.document.getText(editor.selection);
	if (!text.trim()) {
		vscode.window.showErrorMessage('Selected text is empty');
		return;
	}

	try {
		const start = editor.selection.start;
		const result = buildMultiQueryLineage(text, { line: start.line + 1, column: start.character + 1 });
		const queriesWithLineage = result.queries.filter(q => q.graph.nodes.length > 0);

		if (queriesWithLineage.length === 0) {
			vscode.window.showInformationMessage('No table references found in selection');
			return;
		}

		showMultiLineagePanel(result, context);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to analyze lineage: ${error.message}`);
	}
};

// Toggle Lineage Export Theme
export const commandSetLineageExportTheme = async function (...args: any[]) {
	const config = vscode.workspace.getConfiguration('fabricSql');
	const currentTheme = config.get<string>('lineageExportTheme', 'dark');

	// Toggle between dark and light
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

	await config.update('lineageExportTheme', newTheme, vscode.ConfigurationTarget.Global);

	const themeDescription = newTheme === 'dark'
		? 'dark background with light text'
		: 'white background with dark text';

	vscode.window.showInformationMessage(`Fabric SQL: Lineage export theme switched to ${newTheme} (${themeDescription})`);
};
