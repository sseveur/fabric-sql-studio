import * as vscode from 'vscode';
import { disposeAllClients } from '../services/sqlServerClient';
import { authenticationWebviewProvider } from '../extension';
import { describeToken, getAccessToken, SCOPE_FABRIC, SCOPE_TDS, signIn, signOut } from '../services/auth';
import { COMMAND_AUTHENTICATION_REFRESH } from './ids';

export const commandUserLogin = async function (...args: any[]) {

	resetFabricSqlClient();

	try {
		const account = await signIn();
		if (account) {
			vscode.window.showInformationMessage(`Signed in as ${account}`);
		} else {
			vscode.window.showWarningMessage('Sign-in was cancelled or no account is available.');
		}
	} catch (error: any) {
		vscode.window.showErrorMessage(`Sign-in failed: ${error?.message ?? error}`);
	}

	vscode.commands.executeCommand(COMMAND_AUTHENTICATION_REFRESH);

};

let authOutput: vscode.OutputChannel | null = null;

/** Diagnostics: audience / tenant / expiry for both token scopes. Never prints the token. */
export const commandAuthTokenInfo = async function (...args: any[]) {

	if (!authOutput) { authOutput = vscode.window.createOutputChannel('Fabric SQL Studio: Auth'); }
	const out = authOutput;
	out.clear();
	out.show(true);

	for (const [name, scope] of [['SQL (TDS)', SCOPE_TDS], ['Fabric REST', SCOPE_FABRIC]] as const) {
		out.appendLine(`== ${name} — ${scope}`);
		try {
			const info = await getAccessToken(scope, true);
			if (!info) { out.appendLine('   no session'); continue; }
			for (const [k, v] of Object.entries(describeToken(info))) { out.appendLine(`   ${k}: ${v}`); }
		} catch (error: any) {
			out.appendLine(`   ERROR: ${error?.message ?? error}`);
		}
	}

};

export const commandAuthenticationRefresh = function (...args: any[]) {

	resetFabricSqlClient();

	authenticationWebviewProvider.refresh();

};

const resetFabricSqlClient = function () {
	disposeAllClients();
};

// Sign out (via Command Palette or the Authentication view)
export const commandRevokeSession = async function (...args: any[]) {
	try {
		resetFabricSqlClient();
		await signOut();
		vscode.window.showInformationMessage('Signed out. To remove the Microsoft account entirely, use the VS Code Accounts menu.');
		vscode.commands.executeCommand(COMMAND_AUTHENTICATION_REFRESH);
	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to sign out: ${error.message || error}`);
	}
};
