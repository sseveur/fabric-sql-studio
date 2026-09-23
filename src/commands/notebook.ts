import * as vscode from 'vscode';
import { textToNotebookData } from '../notebook/fsqlNotebookSerializer';

// Open current SQL file as a Fabric SQL notebook (inline results)
export const commandOpenAsNotebook = async function (uri?: vscode.Uri) {
	const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
	if (!targetUri) {
		vscode.window.showWarningMessage('Open a .sql or .fsql file first.');
		return;
	}

	// Unsaved (untitled) buffers have no file for the notebook serializer to read —
	// vscode.openWith would yield an empty notebook. Build the notebook directly from the
	// text buffer and open it as an untitled notebook instead.
	if (targetUri.scheme === 'untitled') {
		if (typeof vscode.window.showNotebookDocument !== 'function') {
			vscode.window.showWarningMessage('Save the file first to open it as a notebook (this VS Code version cannot convert unsaved buffers).');
			return;
		}
		const textDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === targetUri.toString());
		const notebook = await vscode.workspace.openNotebookDocument(
			'fabric-sql-notebook',
			textToNotebookData(textDoc?.getText() ?? '')
		);
		await vscode.window.showNotebookDocument(notebook);
		return;
	}

	await vscode.commands.executeCommand('vscode.openWith', targetUri, 'fabric-sql-notebook');
};

// Open current notebook as a plain text editor
export const commandOpenAsText = async function (uri?: vscode.Uri) {
	const targetUri = uri || vscode.window.activeNotebookEditor?.notebook.uri;
	if (!targetUri) {
		vscode.window.showWarningMessage('No notebook is currently active.');
		return;
	}

	// Close the specific notebook tab (not the active editor) so reopening
	// the same URI switches from notebook to text instead of revealing.
	const uriStr = targetUri.toString();
	const notebookTabs = vscode.window.tabGroups.all
		.flatMap(g => g.tabs)
		.filter(t => t.input instanceof vscode.TabInputNotebook && t.input.uri.toString() === uriStr);

	for (const tab of notebookTabs) {
		await vscode.window.tabGroups.close(tab);
	}

	const doc = await vscode.workspace.openTextDocument(targetUri);
	await vscode.window.showTextDocument(doc, { preview: false });
};
