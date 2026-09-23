import * as vscode from 'vscode';
import { getSparkTarget, getSparkState, onDidChangeSpark, SETTING_SPARK_LAKEHOUSE } from '../services/sparkClient';

/**
 * Sidebar "Spark" section: which lakehouse Spark SQL runs on, whether a session is live, and
 * buttons to switch lakehouse / stop the session. Mirrors the status bar item, which is easy to miss.
 */
export class SparkTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly subs: vscode.Disposable[];

    constructor() {
        this.subs = [
            onDidChangeSpark(() => this.changed.fire()),
            vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(SETTING_SPARK_LAKEHOUSE)) { this.changed.fire(); } }),
        ];
    }

    dispose(): void { this.subs.forEach(s => s.dispose()); this.changed.dispose(); }

    getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

    getChildren(): vscode.TreeItem[] {
        const target = getSparkTarget();
        const state = getSparkState();

        const lakehouse = new vscode.TreeItem(target ? target.label : 'No lakehouse selected');
        lakehouse.description = 'lakehouse';
        lakehouse.tooltip = 'Spark SQL runs on this lakehouse. Click to change.';
        lakehouse.iconPath = new vscode.ThemeIcon('database');
        lakehouse.contextValue = 'fsql-spark-lakehouse';
        lakehouse.command = { command: 'fabricSql.select-spark-lakehouse', title: 'Select Spark Lakehouse' };

        const session = new vscode.TreeItem(state ? `Session ${state}` : 'No session running');
        session.description = state ? 'uses capacity until stopped' : 'starts on first Spark run';
        session.tooltip = state
            ? 'A Spark session is live on the lakehouse. Stop it when done; Fabric also stops it after 20 idle minutes.'
            : 'Select Spark SQL in the editor and press Ctrl+Shift+Enter. The first run takes 1–3 minutes to start Spark.';
        session.iconPath = new vscode.ThemeIcon(state ? 'zap' : 'circle-slash', state ? new vscode.ThemeColor('charts.yellow') : undefined);
        session.contextValue = state ? 'fsql-spark-session-live' : 'fsql-spark-session-none';

        const hint = new vscode.TreeItem('Run selection as Spark SQL');
        hint.description = 'Ctrl+Shift+Enter';
        hint.iconPath = new vscode.ThemeIcon('play');
        hint.command = { command: 'fabricSql.run-spark-query', title: 'Run as Spark SQL' };

        return [lakehouse, session, hint];
    }
}
