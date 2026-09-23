import { CancellationToken, Event, InlayHint, InlayHintsProvider, Position, ProviderResult, Range, TextDocument } from "vscode";
import { isFabricSqlLanguage } from "../services/languageUtils";


export class FsqlInlayHintsProvider implements InlayHintsProvider<InlayHint>{

    onDidChangeInlayHints?: Event<void> | undefined;
    provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): ProviderResult<InlayHint[]> {
        if (!isFabricSqlLanguage(document.languageId)) { return []; }
        return [];
        //     {
        //     label: "label123",
        //     position: new Position(0, 33),

        // } as InlayHint
    }

}