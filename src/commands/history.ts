import * as vscode from 'vscode';
import { renderRequestDetailsHtml } from '../activitybar/jobDetailsPanel';
import { QueryHistoryItem, QueryHistoryService } from '../services/queryHistoryService';
import { COMMAND_RUN_QUERY } from './ids';

// Query History
let queryHistoryService: QueryHistoryService | null = null;

export function initQueryHistoryService(globalState: vscode.Memento): QueryHistoryService {
	if (!queryHistoryService) {
		queryHistoryService = new QueryHistoryService(globalState);
	}
	return queryHistoryService;
}

export function getQueryHistoryService(): QueryHistoryService | null {
	return queryHistoryService;
}

// Helper to extract QueryHistoryItem from either direct item or TreeItem
function extractHistoryItem(arg: any): QueryHistoryItem | null {
	if (!arg) {return null;}
	// If it's a TreeItem with historyItem property
	if (arg.historyItem) {return arg.historyItem;}
	// If it's the QueryHistoryItem directly
	if (arg.query && arg.timestamp) {return arg;}
	return null;
}

export const commandHistoryRerun = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.query) {
		return;
	}

	// Create a new untitled document with the query
	const doc = await vscode.workspace.openTextDocument({
		language: 'fsql',
		content: item.query
	});
	await vscode.window.showTextDocument(doc);

	// Run the query
	vscode.commands.executeCommand(COMMAND_RUN_QUERY);
};

export const commandHistoryCopy = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.query) {
		return;
	}
	await vscode.env.clipboard.writeText(item.query);
	vscode.window.showInformationMessage('Query copied to clipboard');
};

export const commandHistoryShow = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.query) {
		return;
	}

	// Create a new untitled document with the query (read-only preview)
	const doc = await vscode.workspace.openTextDocument({
		language: 'fsql',
		content: item.query
	});
	await vscode.window.showTextDocument(doc, { preview: true });
};

// Server-side Job History: click → open the job's SQL (or a summary when it has none).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commandJobHistoryShow = async function (arg: any) {
	const entry = arg?.entry;
	if (!entry) { return; }
	const content = entry.query
		?? [
			`-- Job ${entry.jobReference.jobId}`,
			`-- Type: ${entry.jobType}${entry.statementType ? ' / ' + entry.statementType : ''}`,
			`-- State: ${entry.state}${entry.errorMessage ? '\n-- Error: ' + entry.errorMessage : ''}`,
		].join('\n');
	const doc = await vscode.workspace.openTextDocument({ language: 'fsql', content });
	await vscode.window.showTextDocument(doc, { preview: true });
};

// Server-side Job History: request details panel (timings, scanned data, CPU, statement text).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commandJobHistoryDetails = async function (arg: any) {
	const entry = arg?.entry;
	if (!entry) { return; }
	const panel = vscode.window.createWebviewPanel(
		'fabric-sql-job-details',
		`Request: ${String(entry.jobReference.jobId).slice(0, 8)}`,
		{ viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
		{ enableFindWidget: true, enableScripts: false }
	);
	panel.webview.html = renderRequestDetailsHtml(entry);
};

export const commandHistoryDelete = async function (arg: any) {
	const item = extractHistoryItem(arg);
	if (!item || !item.id || !queryHistoryService) {
		return;
	}
	await queryHistoryService.removeEntry(item.id);
};

export const commandHistoryClear = async function () {
	if (!queryHistoryService) {
		return;
	}

	const confirm = await vscode.window.showWarningMessage(
		'Clear all query history?',
		{ modal: true },
		'Clear'
	);

	if (confirm === 'Clear') {
		await queryHistoryService.clearHistory();
		vscode.window.showInformationMessage('Query history cleared');
	}
};
