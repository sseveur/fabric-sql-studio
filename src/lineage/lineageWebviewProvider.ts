import * as vscode from 'vscode';
import { MultiLineageResult } from '../services/lineageGraph';
import { calculateLayout } from './dagLayout';
import { renderGraphToSvg } from './svgRenderer';
import { exportFilename, LineageSection, renderLineageHtml } from './lineageHtml';
import { LineageExportService } from './lineageExportService';

const VIEW_TYPE = 'fabric-sql-lineage';

let currentPanel: vscode.WebviewPanel | undefined;
let messageHandlerDisposable: vscode.Disposable | undefined;
let configChangeDisposable: vscode.Disposable | undefined;
let sourceDocument: vscode.TextDocument | undefined;

// Rendered sections of the open panel, indexed like the webview's queryIndex, for export
let currentSvgData: LineageSection[] | null = null;

/**
 * Show lineage panel for multiple queries (stacked vertically)
 */
export function showMultiLineagePanel(result: MultiLineageResult, context: vscode.ExtensionContext): void {
    const column = vscode.ViewColumn.Beside;

    // Store reference to the source document before panel takes focus
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        sourceDocument = editor.document;
    }

    // If panel already exists, reveal and update it
    if (currentPanel) {
        currentPanel.reveal(column);
        updateMultiPanelContent(currentPanel, result);
        return;
    }

    // Create new panel
    currentPanel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'Data Lineage',
        column,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    updateMultiPanelContent(currentPanel, result);

    // Handle messages from webview
    messageHandlerDisposable = currentPanel.webview.onDidReceiveMessage(message => {
        if (message.type === 'navigate') {
            navigateToPosition(message.line, message.column, message.fullName);
        } else if (message.type === 'scrollToQuery') {
            navigateToLine(message.line);
        } else if (message.type === 'exportPngData') {
            handleExportPngData(message);
        } else if (message.type === 'exportAllPngData') {
            handleExportAllPngData(message);
        } else if (message.type === 'exportError') {
            vscode.window.showErrorMessage(`Failed to export: ${message.error}`);
        }
    });

    // Push export theme changes to webview in real-time
    configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('fabricSql.lineageExportTheme') && currentPanel) {
            const theme = vscode.workspace.getConfiguration('fabricSql').get<string>('lineageExportTheme', 'dark');
            currentPanel.webview.postMessage({ type: 'themeChanged', theme });
        }
    });

    // Handle panel disposal
    currentPanel.onDidDispose(() => {
        currentPanel = undefined;
        sourceDocument = undefined;
        currentSvgData = null;
        if (messageHandlerDisposable) {
            messageHandlerDisposable.dispose();
            messageHandlerDisposable = undefined;
        }
        if (configChangeDisposable) {
            configChangeDisposable.dispose();
            configChangeDisposable = undefined;
        }
    });
}

function updateMultiPanelContent(panel: vscode.WebviewPanel, result: MultiLineageResult): void {
    // Layout + SVG once per query; the page and the PNG/PDF export share them
    const sections: LineageSection[] = result.queries
        .filter(q => q.graph.nodes.length > 0)
        .map(queryInfo => {
            const { width, height } = calculateLayout(queryInfo.graph);
            return { queryInfo, svg: renderGraphToSvg(queryInfo.graph, width, height) };
        });
    currentSvgData = sections;

    const exportTheme = vscode.workspace.getConfiguration('fabricSql').get<string>('lineageExportTheme', 'dark');
    panel.webview.html = renderLineageHtml(sections, exportTheme);
}

/**
 * Handle export PNG data received from webview (single image)
 */
async function handleExportPngData(message: {
    format: 'png' | 'pdf';
    pngBase64: string;
    width: number;
    height: number;
    queryIndex?: number;
}): Promise<void> {
    const queryIndex = message.queryIndex;
    const queryInfo = currentSvgData && queryIndex !== undefined ? currentSvgData[queryIndex]?.queryInfo : undefined;
    const lineRange = queryInfo ? `${queryInfo.startLine}-${queryInfo.endLine}` : undefined;
    const filename = exportFilename(message.format, queryIndex, lineRange);

    if (message.format === 'png') {
        await LineageExportService.exportToPng(message.pngBase64, filename);
    } else {
        await LineageExportService.exportToPdf(message.pngBase64, message.width, message.height, filename);
    }
}

/**
 * Handle export all PNG data received from webview (multiple images)
 */
async function handleExportAllPngData(message: {
    format: 'png' | 'pdf';
    items: Array<{ pngBase64: string; width: number; height: number; queryIndex: number }>;
}): Promise<void> {
    if (message.format === 'png') {
        const pngDataItems = message.items.map(item => ({
            pngBase64: item.pngBase64,
            queryIndex: item.queryIndex,
            lineRange: currentSvgData?.[item.queryIndex]?.queryInfo
                ? `${currentSvgData[item.queryIndex].queryInfo!.startLine}-${currentSvgData[item.queryIndex].queryInfo!.endLine}`
                : ''
        }));
        await LineageExportService.exportMultipleToPng(pngDataItems, 'lineage_all_queries.png');
    } else {
        const pdfDataItems = message.items.map(item => ({
            pngBase64: item.pngBase64,
            width: item.width,
            height: item.height,
            title: `Query ${item.queryIndex + 1}`
        }));
        await LineageExportService.exportMultipleToMultiPagePdf(pdfDataItems, 'lineage_all_queries.pdf');
    }
}

/**
 * Navigate to a specific line in the source document
 */
async function navigateToLine(line: number): Promise<void> {
    if (!sourceDocument) {
        return;
    }

    const editor = await vscode.window.showTextDocument(sourceDocument, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false
    });

    if (line > 0) {
        const position = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
        );
    }
}

/**
 * Navigate to a specific position in the source document
 */
async function navigateToPosition(line?: number, column?: number, fullName?: string): Promise<void> {
    // Use stored source document
    if (!sourceDocument) {
        vscode.window.showWarningMessage('No source document available');
        return;
    }

    // Show the document first to get an editor
    const editor = await vscode.window.showTextDocument(sourceDocument, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false
    });

    // If we have exact position, use it
    if (line && line > 0) {
        const position = new vscode.Position(line - 1, (column || 1) - 1);

        // Find the end of the table name for selection
        const lineText = sourceDocument.lineAt(line - 1).text;
        let endColumn = (column || 1) - 1;

        // Try to select the full table name
        if (fullName) {
            const searchStart = Math.max(0, (column || 1) - 1);
            const nameToFind = fullName.split('.').pop() || fullName;
            const idx = lineText.toLowerCase().indexOf(nameToFind.toLowerCase(), searchStart);
            if (idx >= 0) {
                endColumn = idx + nameToFind.length;
            }
        }

        const endPosition = new vscode.Position(line - 1, endColumn);
        editor.selection = new vscode.Selection(position, endPosition);
        editor.revealRange(
            new vscode.Range(position, endPosition),
            vscode.TextEditorRevealType.InCenter
        );
        return;
    }

    // Fallback: search for the table name if no position
    if (fullName) {
        const text = sourceDocument.getText();
        const searchTerm = fullName.split('.').pop() || fullName;
        const regex = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`, 'i');
        const match = regex.exec(text);

        if (match) {
            const position = sourceDocument.positionAt(match.index);
            const endPosition = sourceDocument.positionAt(match.index + match[0].length);
            editor.selection = new vscode.Selection(position, endPosition);
            editor.revealRange(
                new vscode.Range(position, endPosition),
                vscode.TextEditorRevealType.InCenter
            );
        }
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
