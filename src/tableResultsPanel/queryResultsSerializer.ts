import * as vscode from 'vscode';
import { QueryResultsMappingService } from '../services/queryResultsMappingService';
import { ResultsRender } from '../services/resultsRender';
import { ResultsGridRender } from './resultsGridRender';
import { SqlClearMessage } from './resultContract';

export class QueryResultsSerializer implements vscode.WebviewPanelSerializer {

    private globalState: vscode.Memento;
    private queryResultsWebviewMapping: Map<string, ResultsRender>;

    constructor(globalState: vscode.Memento, queryResultsWebviewMapping: Map<string, ResultsRender>) {
        this.globalState = globalState;
        this.queryResultsWebviewMapping = queryResultsWebviewMapping;
    }

    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any): Promise<void> {

        const uuid = webviewPanel.title.substring(webviewPanel.title.length - 8);

        const resultsGridRender = new ResultsGridRender(webviewPanel);

        webviewPanel.webview.onDidReceiveMessage(async c => {
            if ((c as any).command === 'load_complete') {
                await loadComplete(resultsGridRender, state);
            } else {
                ResultsGridRender.executeCommand(c);
            }
        });

        await resultsGridRender.render2();

        QueryResultsMappingService.updateQueryResultsMappingWebviewPanel(this.queryResultsWebviewMapping, uuid, resultsGridRender);

        //action when panel is closed
        webviewPanel.onDidDispose(e => {
            QueryResultsMappingService.deleteQueryResultsMapping(this.globalState, uuid);
        });
    }
}

/**
 * A restored panel comes back empty: T-SQL results are held in memory for the session and
 * cannot be re-fetched by id after a restart. The editor mapping is kept so re-running the
 * query lands in this panel again.
 */
let loadComplete = async function (resultsGridRender: ResultsGridRender, _state: any): Promise<void> {
    await resultsGridRender.postMessage({ requestType: 'clear' } as SqlClearMessage);
};
