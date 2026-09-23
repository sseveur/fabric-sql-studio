import * as vscode from 'vscode';
import { clientFor } from '../services/sqlServerClient';
import { showQueryStatus } from '../language/sqlDiagnostics';
import { pickConnectionFor } from '../services/queryRouter';
import { formatEstimate, parsePlanEstimate, parsePlanStatements, prettyXml, renderPlanHtml } from '../services/planEstimate';
import { warnNoConnection } from './query';

/**
 * Estimated execution plan for the editor text (SET SHOWPLAN_XML ON): summary in the status bar,
 * full plan XML in a new editor. Nothing is executed.
 */
export const commandExplainQuery = async function () {
	const editor = vscode.window.activeTextEditor;
	if (!editor) { return; }
	const sql = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
	if (!sql.trim()) { return; }

	const route = await pickConnectionFor(sql);
	if (!route) { return warnNoConnection(); }

	try {
		const xml = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: `Estimating plan on ${route.conn.id}…` },
			() => clientFor(route.conn).explain(sql));
		lastPlanXml = xml;
		const estimate = parsePlanEstimate(xml);
		showQueryStatus(`${formatEstimate(estimate)} · ${route.conn.id}`,
			[`${estimate.statements} statement(s)`, ...estimate.topOperators.map(o => `  ${o}`), ...(estimate.warnings.length ? ['Warnings: ' + estimate.warnings.join(', ')] : [])].join('\n'));

		if (!planPanel) {
			planPanel = vscode.window.createWebviewPanel('fabric-sql-plan', 'Estimated Plan', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableFindWidget: true, enableScripts: false, retainContextWhenHidden: true });
			planPanel.onDidDispose(() => { planPanel = null; });
		} else {
			planPanel.reveal(undefined, true);
		}
		planPanel.webview.html = renderPlanHtml(parsePlanStatements(xml), route.conn.id, xml);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Estimated plan failed: ${error?.message ?? error}`);
	}
};

let planPanel: vscode.WebviewPanel | null = null;

let lastPlanXml: string | null = null;

/** Raw SHOWPLAN XML of the last estimate, indented, for SSMS / plan-viewer users. */
export const commandExplainQueryXml = async function () {
	if (!lastPlanXml) {
		await commandExplainQuery();
		if (!lastPlanXml) { return; }
	}
	const doc = await vscode.workspace.openTextDocument({ language: 'xml', content: prettyXml(lastPlanXml) });
	await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
};
