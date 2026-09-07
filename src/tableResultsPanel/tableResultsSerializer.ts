import * as vscode from 'vscode';
import { COMMAND_VIEW_TABLE } from '../extensionCommands';
import { parseKey } from '../services/objectRef';

/** Restores a table-preview panel after restart: the panel title is the object's ref key. */
export class TableResultsSerializer implements vscode.WebviewPanelSerializer {

    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, _state: any): Promise<void> {
        const ref = parseKey(webviewPanel.title);
        if (ref && ref.name) {
            vscode.commands.executeCommand(COMMAND_VIEW_TABLE, { ref }, webviewPanel);
        }
    }
}
