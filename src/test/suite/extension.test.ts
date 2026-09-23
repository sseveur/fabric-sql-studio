import * as assert from 'assert';
import * as vscode from 'vscode';
import { COMMAND_DOWNLOAD_CSV, COMMAND_DOWNLOAD_JSONL, COMMAND_RUN_QUERY } from '../../extensionCommands';
import { LocalMemento } from './localMemento';

suite('Extension Test Suite', async () => {
	vscode.window.showInformationMessage('Start all tests.');

	let globalState: LocalMemento = new LocalMemento();
	let queryResultsWebviewMapping: Map<string, vscode.WebviewPanel> = new Map<string, vscode.WebviewPanel>();

	test('COMMAND_RUN_QUERY: SELECT 1,2,3', async () => {

		const doc = await vscode.workspace.openTextDocument({
			language: 'fsql',
			content: 'SELECT 1,2,3'
		});

		await vscode.commands.executeCommand<vscode.TextDocumentShowOptions>("vscode.open", doc.uri);

		let commandInput = {
			"globalState": globalState,
			queryResultsWebviewMapping: queryResultsWebviewMapping
		};

		await vscode.commands.executeCommand(COMMAND_RUN_QUERY, commandInput);

		//there is a second group tab
		const secondGroupTab = vscode.window.tabGroups.all.find(c => c.viewColumn === vscode.ViewColumn.Two);
		assert.ok(secondGroupTab !== null && secondGroupTab !== undefined);

		//
		if (secondGroupTab !== null && secondGroupTab !== undefined) {
			assert.ok(secondGroupTab.tabs.length > 0);
			assert.equal(secondGroupTab.tabs.length,
				secondGroupTab
					.tabs
					.filter(c => ((c.input as any).viewType as string)?.endsWith("-fabric-sql-query-results")).length);
		}

	});

	test('COMMAND_RUN_QUERY: SELECT 1,2,3 - DOWNLOAD CSV', async (...args: any[]) => {

		//there is a second group tab
		const secondGroupTab = vscode.window.tabGroups.all.find(c => c.viewColumn === vscode.ViewColumn.Two);
		assert.ok(secondGroupTab !== null && secondGroupTab !== undefined);

		//
		if (secondGroupTab !== null && secondGroupTab !== undefined) {
			assert.ok(secondGroupTab.tabs.length > 0);

			const path = process.env.GITHUB_WORKSPACE || __dirname;
			const downloadFileUri = vscode.Uri.joinPath(vscode.Uri.file(path), 'download1.csv');

			let showOpenDialogCount = 0;
			vscode.window.showSaveDialog = function (options?: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined> {

				if (options !== undefined) {
					showOpenDialogCount++;

					assert.equal('Save export', options?.title);
					assert.ok(options?.filters?.csv);
					assert.ok(options?.filters?.csv.length);
					assert.equal('csv', options?.filters?.csv[0]);

					return new Promise((resolve, reject) => { resolve(downloadFileUri); });
				} else {
					return new Promise((resolve, reject) => { reject('options not defined'); });
				}
			};

			let showInformationMessageCount = 0;
			vscode.window.showInformationMessage = function (message: string, ...items: any[]): Thenable<any | undefined> {

				showInformationMessageCount++;

				return new Promise((resolve, reject) => { resolve(undefined); });
			};

			await vscode.commands.executeCommand('workbench.action.focusNextGroup');
			await vscode.commands.executeCommand(COMMAND_DOWNLOAD_CSV);

			assert.equal(1, showOpenDialogCount);
			if (downloadFileUri !== undefined) {
				const fileContent = await vscode.workspace.fs.readFile(downloadFileUri);
				const fileContentString = new TextDecoder().decode(fileContent);
				assert('f0_,f1_,f2_\n1,2,3', fileContentString);

			} else {
				assert.fail('unexpected');
			}

			assert.equal(2, showInformationMessageCount);

		} else {
			assert.fail('mapping not found');
		}

	});

	test('COMMAND_RUN_QUERY: INSERT', async () => {

		// await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		// await vscode.commands.executeCommand('workbench.action.closeAllGroups');

		const doc = await vscode.workspace.openTextDocument({
			language: 'fsql',
			content: 'INSERT INTO Business.dataflow_test SELECT CURRENT_TIMESTAMP(), "NAME" as NAME, "body"'
		});

		await vscode.commands.executeCommand<vscode.TextDocumentShowOptions>("vscode.open", doc.uri);

		let commandInput = {
			"globalState": globalState,
			queryResultsWebviewMapping: queryResultsWebviewMapping
		};

		await vscode.commands.executeCommand(COMMAND_RUN_QUERY, commandInput);

		//there is a second group tab
		const secondGroupTab = vscode.window.tabGroups.all.find(c => c.viewColumn === vscode.ViewColumn.Two);
		assert.ok(secondGroupTab !== null && secondGroupTab !== undefined);

		//
		if (secondGroupTab !== null && secondGroupTab !== undefined) {
			assert.ok(secondGroupTab.tabs.length > 0);
			assert.equal(secondGroupTab.tabs.length,
				secondGroupTab
					.tabs
					.filter(c => ((c.input as any).viewType as string)?.endsWith("-fabric-sql-query-results")).length);
		}

	});

	test('COMMAND_RUN_QUERY: INSERT - DOWNLOAD CSV', async (...args: any[]) => {

		//there is a second group tab
		const secondGroupTab = vscode.window.tabGroups.all.find(c => c.viewColumn === vscode.ViewColumn.Two);
		assert.ok(secondGroupTab !== null && secondGroupTab !== undefined);

		//
		if (secondGroupTab !== null && secondGroupTab !== undefined) {
			assert.ok(secondGroupTab.tabs.length > 0);

			const path = process.env.GITHUB_WORKSPACE || __dirname;
			const downloadFileUri = vscode.Uri.joinPath(vscode.Uri.file(path), 'download2.csv');

			let showOpenDialogCount = 0;
			vscode.window.showSaveDialog = function (options?: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined> {

				if (options !== undefined) {
					showOpenDialogCount++;

					assert.equal('Save export', options?.title);
					assert.ok(options?.filters?.csv);
					assert.ok(options?.filters?.csv.length);
					assert.equal('csv', options?.filters?.csv[0]);

					return new Promise((resolve, reject) => { resolve(downloadFileUri); });
				} else {
					return new Promise((resolve, reject) => { reject('options not defined'); });
				}
			};

			let showInformationMessageCount = 0;
			vscode.window.showInformationMessage = function (message: string, ...items: any[]): Thenable<any | undefined> {

				showInformationMessageCount++;

				return new Promise((resolve, reject) => { resolve(undefined); });
			};

			await vscode.commands.executeCommand('workbench.action.focusNextGroup');
			assert.ok(
				secondGroupTab.tabs
					.find(t => t.label.startsWith('Visualization: INSERT'))
					?.isActive
			);
			await vscode.commands.executeCommand(COMMAND_DOWNLOAD_CSV);

			assert.equal(1, showOpenDialogCount);
			if (downloadFileUri !== undefined) {
				const fileContent = await vscode.workspace.fs.readFile(downloadFileUri);
				const fileContentString = new TextDecoder().decode(fileContent);
				assert('insertedRowCount,updatedRowCount,deletedRowCount\n1,,', fileContentString);

			} else {
				assert.fail('unexpected');
			}

			assert.equal(2, showInformationMessageCount);

		} else {
			assert.fail('mapping not found');
		}

	});

	test('COMMAND_RUN_QUERY: DELETE', async () => {

		// await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		// await vscode.commands.executeCommand('workbench.action.closeAllGroups');

		const doc = await vscode.workspace.openTextDocument({
			language: 'fsql',
			content: 'DELETE Business.dataflow_test WHERE timestamp <= CURRENT_TIMESTAMP()'
		});

		await vscode.commands.executeCommand<vscode.TextDocumentShowOptions>("vscode.open", doc.uri);

		let commandInput = {
			"globalState": globalState,
			queryResultsWebviewMapping: queryResultsWebviewMapping
		};

		await vscode.commands.executeCommand(COMMAND_RUN_QUERY, commandInput);

		//there is a second group tab
		const secondGroupTab = vscode.window.tabGroups.all.find(c => c.viewColumn === vscode.ViewColumn.Two);
		assert.ok(secondGroupTab !== null && secondGroupTab !== undefined);

		//
		if (secondGroupTab !== null && secondGroupTab !== undefined) {
			assert.ok(secondGroupTab.tabs.length > 0);
			assert.equal(secondGroupTab.tabs.length,
				secondGroupTab
					.tabs
					.filter(c => ((c.input as any).viewType as string)?.endsWith("-fabric-sql-query-results")).length);
		}

	});

	test('COMMAND_RUN_QUERY: DELETE - DOWNLOAD JSONL', async (...args: any[]) => {

		//there is a second group tab
		const secondGroupTab = vscode.window.tabGroups.all.find(c => c.viewColumn === vscode.ViewColumn.Two);
		assert.ok(secondGroupTab !== null && secondGroupTab !== undefined);

		//
		if (secondGroupTab !== null && secondGroupTab !== undefined) {
			assert.ok(secondGroupTab.tabs.length > 0);

			const path = process.env.GITHUB_WORKSPACE || __dirname;
			const downloadFileUri = vscode.Uri.joinPath(vscode.Uri.file(path), 'download1.jsonl');

			let showOpenDialogCount = 0;
			vscode.window.showSaveDialog = function (options?: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined> {

				if (options !== undefined) {
					showOpenDialogCount++;

					assert.equal('Save export', options?.title);
					assert.ok(options?.filters?.jsonl);
					assert.ok(options?.filters?.jsonl.length);
					assert.equal('jsonl', options?.filters?.jsonl[0]);

					return new Promise((resolve, reject) => { resolve(downloadFileUri); });
				} else {
					return new Promise((resolve, reject) => { reject('options not defined'); });
				}
			};

			// let showInformationMessageCount = 0;
			// vscode.window.showInformationMessage = function (message: string, ...items: any[]): Thenable<any | undefined> {

			// 	showInformationMessageCount++;

			// 	return new Promise((resolve, reject) => { resolve(undefined); });
			// };

			await vscode.commands.executeCommand('workbench.action.focusNextGroup');
			assert.ok(
				secondGroupTab.tabs
					.find(t => t.label.startsWith('Visualization: DELETE'))
					?.isActive
			);
			await vscode.commands.executeCommand(COMMAND_DOWNLOAD_JSONL);

			// assert.equal(1, showOpenDialogCount);
			if (downloadFileUri !== undefined) {
				const fileContent = await vscode.workspace.fs.readFile(downloadFileUri);
				const fileContentString = new TextDecoder().decode(fileContent);
				assert('{"insertedRowCount":null,"updatedRowCount":null,"deletedRowCount":1}', fileContentString);

			} else {
				assert.fail('unexpected');
			}

			// assert.equal(2, showInformationMessageCount);

		} else {
			assert.fail('mapping not found');
		}

	});

});
