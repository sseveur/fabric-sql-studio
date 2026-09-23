import * as vscode from "vscode";
import { getExtensionUri } from "./extension";

export class Icons {

    public fabricSql: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'fabric-sql.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'fabric-sql.svg')
    };

    public datasetLink: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'dataset-link.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'dataset-link.svg')
    };

    public dataset: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'dataset.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'dataset.svg')
    };

    public group: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'group.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'group.svg')
    };

    public model: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'model.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'model.svg')
    };

    public person: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'person.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'person.svg')
    };

    public routine: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'routine.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'routine.svg')
    };

    public tablePartitioned: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'table-partitioned.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'table-partitioned.svg')
    };

    public tableView: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'table-view.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'table-view.svg')
    };

    public table: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'table.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'table.svg')
    };

    public pinned: { light: vscode.Uri; dark: vscode.Uri } = {
        light: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'light', 'pinned.svg'),
        dark: vscode.Uri.joinPath(getExtensionUri(), 'resources', 'dark', 'pinned.svg')
    };

}