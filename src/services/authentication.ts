import * as vscode from 'vscode';

/**
 * ponytail: shim. The gcloud-backed Authentication class is gone; the only thing the
 * BigQuery-era code still needs from it is "which project do bare queries target".
 * Backed by globalState until M3 replaces it with the active connection profile.
 */
export class Authentication {

    private static globalState: vscode.Memento | null = null;
    private static readonly KEY = 'defaultProjectId';

    public static init(globalState: vscode.Memento): void {
        Authentication.globalState = globalState;
    }

    public static async getDefaultProjectId(): Promise<string> {
        return Authentication.globalState?.get<string>(Authentication.KEY) ?? '';
    }

    public static async setDefaultProjectId(projectId: string): Promise<void> {
        await Authentication.globalState?.update(Authentication.KEY, projectId);
    }
}
