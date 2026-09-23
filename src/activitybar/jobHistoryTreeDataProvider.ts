import * as vscode from 'vscode';
import { getActiveConnection } from '../services/connections';
import {
    describeLiveRequestRow,
    describeQueryInsightsRow,
    historySourceFor,
    jobEntryDescription,
    jobEntryLabel,
    JobHistoryEntry,
    liveRequestsSql,
    queryInsightsSql,
} from '../services/jobHistoryService';
import { clientFor } from '../services/sqlServerClient';

const PAGE_SIZE = 50;

/**
 * Server-side request history for the ACTIVE connection: everything that ran in the item (any
 * tool, any client) — unlike the local Query History view, which only knows queries run here.
 * Fabric: queryinsights.exec_requests_history (paged). SQL Server / Azure SQL: live requests.
 */
export class JobHistoryTreeDataProvider implements vscode.TreeDataProvider<JobHistoryTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<JobHistoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private entries: JobHistoryEntry[] = [];
    private offset = 0;
    private hasMore = false;
    private onlyMine = true;
    private error: string | undefined;
    private note: string | undefined;
    private loaded = false;
    private loading = false;

    refresh(): void {
        this.entries = [];
        this.offset = 0;
        this.hasMore = false;
        this.loaded = false;
        this.error = undefined;
        this.note = undefined;
        this._onDidChangeTreeData.fire();
    }

    toggleAllUsers(): void {
        this.onlyMine = !this.onlyMine;
        vscode.window.setStatusBarMessage(`Job history: ${this.onlyMine ? 'only my requests' : 'all users'}`, 3000);
        this.refresh();
    }

    async loadMore(): Promise<void> {
        await this.fetchPage();
        this._onDidChangeTreeData.fire();
    }

    private async fetchPage(): Promise<void> {
        if (this.loading) { return; }
        this.loading = true;
        try {
            const conn = getActiveConnection();
            if (!conn) { this.error = 'No connection configured.'; return; }
            const client = clientFor(conn);

            if (historySourceFor(conn) === 'queryinsights') {
                const rows = await client.query(queryInsightsSql(this.onlyMine, this.offset, PAGE_SIZE));
                this.entries.push(...rows.map(r => describeQueryInsightsRow(conn.id, r)));
                this.offset += rows.length;
                this.hasMore = rows.length === PAGE_SIZE;
                this.note = 'queryinsights.exec_requests_history · completed requests appear after up to 15 min';
            } else {
                const rows = await client.query(liveRequestsSql(this.onlyMine));
                this.entries = rows.map(r => describeLiveRequestRow(conn.id, r));
                this.hasMore = false;
                this.note = 'sys.dm_exec_requests · currently running requests only (no history without Query Store)';
            }
            this.error = undefined;
        } catch (err: any) {
            this.error = err?.message ?? String(err);
        } finally {
            this.loading = false;
            this.loaded = true;
        }
    }

    getTreeItem(element: JobHistoryTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: JobHistoryTreeItem): Promise<JobHistoryTreeItem[]> {
        if (element) { return []; }
        if (!this.loaded) { await this.fetchPage(); }

        if (this.error) { return [new JobHistoryTreeItem(`Failed to list requests: ${this.error}`, 'empty')]; }
        if (this.entries.length === 0) {
            const item = new JobHistoryTreeItem('No requests found', 'empty');
            item.tooltip = this.note;
            return [item];
        }

        const items = this.entries.map(e => new JobHistoryTreeItem(jobEntryLabel(e), 'job', e));
        if (this.hasMore) { items.push(new JobHistoryTreeItem(`Load ${PAGE_SIZE} more…`, 'more')); }
        return items;
    }
}

export class JobHistoryTreeItem extends vscode.TreeItem {
    public readonly type: 'job' | 'more' | 'empty';
    public readonly entry?: JobHistoryEntry;

    constructor(label: string, type: 'job' | 'more' | 'empty', entry?: JobHistoryEntry) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.type = type;
        this.entry = entry;

        if (type === 'job' && entry) {
            this.iconPath = iconFor(entry);
            this.description = jobEntryDescription(entry);
            this.contextValue = 'fsql-job-history-job';
            this.tooltip = buildTooltip(entry);
            this.command = { command: 'fabricSql.job-history-show', title: 'Show Request', arguments: [this] };
        } else if (type === 'more') {
            this.iconPath = new vscode.ThemeIcon('ellipsis');
            this.command = { command: 'fabricSql.job-history-load-more', title: 'Load more' };
        } else if (type === 'empty') {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}

function iconFor(e: JobHistoryEntry): vscode.ThemeIcon {
    if (e.state === 'FAILED') { return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')); }
    if (e.state === 'CANCELED') { return new vscode.ThemeIcon('circle-slash'); }
    if (e.state === 'RUNNING' || e.state === 'PENDING') { return new vscode.ThemeIcon('sync'); }
    return new vscode.ThemeIcon('check');
}

function buildTooltip(e: JobHistoryEntry): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    const when = e.creationTime ? new Date(e.creationTime).toLocaleString() : 'unknown time';
    md.appendMarkdown(`**${e.statementType ?? e.jobType}** (${when})\n\n`);
    if (e.query) { md.appendCodeblock(e.query.length > 2000 ? e.query.slice(0, 2000) + '…' : e.query, 'sql'); }
    md.appendMarkdown(`\n**Request:** ${e.jobReference.jobId}`);
    if (e.user) { md.appendMarkdown(`\n\n**User:** ${e.user}`); }
    md.appendMarkdown(`\n\n**State:** ${e.state}`);
    if (e.errorMessage) { md.appendMarkdown(`\n\n**Error:** ${e.errorMessage}`); }
    return md;
}
