export interface FsqlDocument {

    items: FsqlDocumentItem[];
}

export interface FsqlDocumentItem {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    item_type: string;
    range: number[];
    items: FsqlDocumentItem[]
}