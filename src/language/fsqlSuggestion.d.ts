import { FsqlDocumentItem } from "./fsqlDocument";

export interface FsqlSuggestion {
    suggestion_type: string;
    table_identifier: FsqlDocumentItem;
    snippets: FsqlSnippet[]
}

export interface FsqlSnippet {
    name: string,
    snippet: string,
    url: string
}
