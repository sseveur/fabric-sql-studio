import { suggest } from './tsqlParser';
import * as vscode from 'vscode';
import { CompletionItemProvider, CompletionItem, CancellationToken, CompletionContext, CompletionList, Position, ProviderResult, TextDocument, CompletionItemKind, MarkdownString } from 'vscode';
import { tableSchemaService } from '../extension';
import { FsqlSuggestion } from './fsqlSuggestion';
import { isFabricSqlLanguage } from '../services/languageUtils';
import { extractCteColumns, getCteNames, CteColumn } from '../services/cteExtractor';
import { extractTableReferences } from '../services/sqlTableExtractor';


export class FsqlCompletionItemProvider implements CompletionItemProvider<CompletionItem> {

    private keywordCase: 'upper' | 'lower' | 'preserve' = 'upper';
    private functionCase: 'upper' | 'lower' | 'preserve' = 'preserve';

    private applyCase(label: string, mode: 'upper' | 'lower' | 'preserve'): string {
        if (mode === 'upper') { return label.toUpperCase(); }
        if (mode === 'lower') { return label.toLowerCase(); }
        return label;
    }

    provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): vscode.CompletionList<vscode.CompletionItem> | vscode.CompletionItem[] | null | undefined {

        if (!isFabricSqlLanguage(document.languageId)) { return null; }

        // Check if in SELECT clause without prefix - show all columns from all tables
        if (this.isInSelectClauseWithoutPrefix(document, position)) {
            const sql = document.getText();
            const tables = this.extractTablesFromQuery(sql);

            if (tables.length > 0) {
                const list = this.getBaseCompletionList();
                const allColumns = this.getAllColumnsFromTables(document, tables);
                list.items.push(...allColumns);
                return list;
            }
        }

        const suggestions = suggest(document.getText(), position.line, position.character) as FsqlSuggestion[];

        const list = this.getBaseCompletionList();

        if (suggestions.length > 0) {
            for (let index0 = 0; index0 < suggestions.length; index0++) {
                const element = suggestions[index0];

                if (element.suggestion_type === 'TableColumns') {

                    const fsql = document.getText();

                    let schema = tableSchemaService.getSchemaFromCache(fsql, element.table_identifier);
                    let columns = schema.filter((element, position) => {
                        return schema.findIndex(e => e.column_name === element.column_name) === position;
                    });

                    for (let index1 = 0; index1 < columns.length; index1++) {
                        const element = columns[index1];
                        let c1 = new CompletionItem(element.column_name, CompletionItemKind.Field);
                        c1.insertText = element.column_name;
                        c1.detail = `${element.data_type}${element.is_partitioning_column === 'YES' ? " - PARTITION COLUMN" : ""}\n\n${element.description ? element.description : ""}`;
                        // c1.command = {
                        //     command: "editor.action.triggerSuggest"
                        // } as vscode.Command;
                        // Use "0_" prefix to prioritize columns over functions/keywords
                        c1.sortText = "0_" + this.pad(index0) + this.pad(element.ordinal_position);

                        list.items.push(c1);
                    }
                }

                // if (element.suggestion_type === 'Function') {
                //     for (let j = 0; j < element.snippets.length; j++) {
                //         const func = element.snippets[j];

                //         const fn = new CompletionItem(func.name, CompletionItemKind.Function);

                //         fn.insertText = new vscode.SnippetString(func.snippet);
                //         // fn.documentation = new MarkdownString('#### Description\nReturns a random universally unique identifier (UUID) as a `STRING`.\nThe returned STRING consists of 32 hexadecimal digits in five groups separated by hyphens in the form 8-4-4-4-12. The hexadecimal digits represent 122 random bits and 6 fixed bits, in compliance with [RFC 4122 section 4.4](https://tools.ietf.org/html/rfc4122#section-4.4). The returned STRING is lowercase.\n#### Return Data Type\nSTRING');
                //         list.items.push(fn);
                //     }

                // }

            }
        }

        // Fallback: Check if user typed "alias." or "cteName." and suggest CTE columns
        const cteColumns = this.getCteColumnsAtPosition(document, position);
        if (cteColumns.length > 0) {
            for (let i = 0; i < cteColumns.length; i++) {
                const col = cteColumns[i];
                let c1 = new CompletionItem(col.name, CompletionItemKind.Field);
                c1.insertText = col.name;
                c1.detail = 'CTE Column';
                // Use "0_" prefix to prioritize columns over functions/keywords
                c1.sortText = "0_" + this.pad(0) + this.pad(i);
                list.items.push(c1);
            }
        }

        return list;
    }

    getBaseCompletionList(): CompletionList<CompletionItem> {

        const config = vscode.workspace.getConfiguration('fabricSql');
        this.keywordCase = config.get<'upper' | 'lower' | 'preserve'>('completionKeywordCase', 'upper');
        this.functionCase = config.get<'upper' | 'lower' | 'preserve'>('completionFunctionCase', 'preserve');

        return new CompletionList<CompletionItem>(
            [
                this.getCompletionItem("CAST", CompletionItemKind.Function),
                this.getCompletionItem("CONVERT", CompletionItemKind.Function),
                this.getCompletionItem("TRY_CAST", CompletionItemKind.Function),
                this.getCompletionItem("TRY_CONVERT", CompletionItemKind.Function),
                this.getCompletionItem("PARSE", CompletionItemKind.Function),
                this.getCompletionItem("TRY_PARSE", CompletionItemKind.Function),
                this.getCompletionItem("COALESCE", CompletionItemKind.Function),
                this.getCompletionItem("NULLIF", CompletionItemKind.Function),
                this.getCompletionItem("ISNULL", CompletionItemKind.Function),
                this.getCompletionItem("IIF", CompletionItemKind.Function),
                this.getCompletionItem("CHOOSE", CompletionItemKind.Function),
                this.getCompletionItem("GREATEST", CompletionItemKind.Function),
                this.getCompletionItem("LEAST", CompletionItemKind.Function),
                this.getCompletionItem("COUNT", CompletionItemKind.Function),
                this.getCompletionItem("COUNT_BIG", CompletionItemKind.Function),
                this.getCompletionItem("SUM", CompletionItemKind.Function),
                this.getCompletionItem("AVG", CompletionItemKind.Function),
                this.getCompletionItem("MIN", CompletionItemKind.Function),
                this.getCompletionItem("MAX", CompletionItemKind.Function),
                this.getCompletionItem("STRING_AGG", CompletionItemKind.Function),
                this.getCompletionItem("STDEV", CompletionItemKind.Function),
                this.getCompletionItem("STDEVP", CompletionItemKind.Function),
                this.getCompletionItem("VAR", CompletionItemKind.Function),
                this.getCompletionItem("VARP", CompletionItemKind.Function),
                this.getCompletionItem("APPROX_COUNT_DISTINCT", CompletionItemKind.Function),
                this.getCompletionItem("APPROX_PERCENTILE_CONT", CompletionItemKind.Function),
                this.getCompletionItem("APPROX_PERCENTILE_DISC", CompletionItemKind.Function),
                this.getCompletionItem("CHECKSUM_AGG", CompletionItemKind.Function),
                this.getCompletionItem("GROUPING", CompletionItemKind.Function),
                this.getCompletionItem("GROUPING_ID", CompletionItemKind.Function),
                this.getCompletionItem("ROW_NUMBER", CompletionItemKind.Function),
                this.getCompletionItem("RANK", CompletionItemKind.Function),
                this.getCompletionItem("DENSE_RANK", CompletionItemKind.Function),
                this.getCompletionItem("NTILE", CompletionItemKind.Function),
                this.getCompletionItem("LAG", CompletionItemKind.Function),
                this.getCompletionItem("LEAD", CompletionItemKind.Function),
                this.getCompletionItem("FIRST_VALUE", CompletionItemKind.Function),
                this.getCompletionItem("LAST_VALUE", CompletionItemKind.Function),
                this.getCompletionItem("PERCENT_RANK", CompletionItemKind.Function),
                this.getCompletionItem("CUME_DIST", CompletionItemKind.Function),
                this.getCompletionItem("PERCENTILE_CONT", CompletionItemKind.Function),
                this.getCompletionItem("PERCENTILE_DISC", CompletionItemKind.Function),
                this.getCompletionItem("ABS", CompletionItemKind.Function),
                this.getCompletionItem("CEILING", CompletionItemKind.Function),
                this.getCompletionItem("FLOOR", CompletionItemKind.Function),
                this.getCompletionItem("ROUND", CompletionItemKind.Function),
                this.getCompletionItem("POWER", CompletionItemKind.Function),
                this.getCompletionItem("SQRT", CompletionItemKind.Function),
                this.getCompletionItem("SQUARE", CompletionItemKind.Function),
                this.getCompletionItem("EXP", CompletionItemKind.Function),
                this.getCompletionItem("LOG", CompletionItemKind.Function),
                this.getCompletionItem("LOG10", CompletionItemKind.Function),
                this.getCompletionItem("SIGN", CompletionItemKind.Function),
                this.getCompletionItem("RAND", CompletionItemKind.Function),
                this.getCompletionItem("PI", CompletionItemKind.Function),
                this.getCompletionItem("ATN2", CompletionItemKind.Function),
                this.getCompletionItem("ATAN", CompletionItemKind.Function),
                this.getCompletionItem("ASIN", CompletionItemKind.Function),
                this.getCompletionItem("ACOS", CompletionItemKind.Function),
                this.getCompletionItem("COS", CompletionItemKind.Function),
                this.getCompletionItem("SIN", CompletionItemKind.Function),
                this.getCompletionItem("TAN", CompletionItemKind.Function),
                this.getCompletionItem("COT", CompletionItemKind.Function),
                this.getCompletionItem("DEGREES", CompletionItemKind.Function),
                this.getCompletionItem("RADIANS", CompletionItemKind.Function),
                this.getCompletionItem("LEN", CompletionItemKind.Function),
                this.getCompletionItem("DATALENGTH", CompletionItemKind.Function),
                this.getCompletionItem("LEFT", CompletionItemKind.Function),
                this.getCompletionItem("RIGHT", CompletionItemKind.Function),
                this.getCompletionItem("SUBSTRING", CompletionItemKind.Function),
                this.getCompletionItem("CHARINDEX", CompletionItemKind.Function),
                this.getCompletionItem("PATINDEX", CompletionItemKind.Function),
                this.getCompletionItem("REPLACE", CompletionItemKind.Function),
                this.getCompletionItem("REPLICATE", CompletionItemKind.Function),
                this.getCompletionItem("REVERSE", CompletionItemKind.Function),
                this.getCompletionItem("STUFF", CompletionItemKind.Function),
                this.getCompletionItem("TRIM", CompletionItemKind.Function),
                this.getCompletionItem("LTRIM", CompletionItemKind.Function),
                this.getCompletionItem("RTRIM", CompletionItemKind.Function),
                this.getCompletionItem("UPPER", CompletionItemKind.Function),
                this.getCompletionItem("LOWER", CompletionItemKind.Function),
                this.getCompletionItem("CONCAT", CompletionItemKind.Function),
                this.getCompletionItem("CONCAT_WS", CompletionItemKind.Function),
                this.getCompletionItem("FORMAT", CompletionItemKind.Function),
                this.getCompletionItem("STR", CompletionItemKind.Function),
                this.getCompletionItem("SPACE", CompletionItemKind.Function),
                this.getCompletionItem("QUOTENAME", CompletionItemKind.Function),
                this.getCompletionItem("ASCII", CompletionItemKind.Function),
                this.getCompletionItem("CHAR", CompletionItemKind.Function),
                this.getCompletionItem("UNICODE", CompletionItemKind.Function),
                this.getCompletionItem("NCHAR", CompletionItemKind.Function),
                this.getCompletionItem("TRANSLATE", CompletionItemKind.Function),
                this.getCompletionItem("STRING_SPLIT", CompletionItemKind.Function),
                this.getCompletionItem("STRING_ESCAPE", CompletionItemKind.Function),
                this.getCompletionItem("SOUNDEX", CompletionItemKind.Function),
                this.getCompletionItem("DIFFERENCE", CompletionItemKind.Function),
                this.getCompletionItem("GETDATE", CompletionItemKind.Function),
                this.getCompletionItem("GETUTCDATE", CompletionItemKind.Function),
                this.getCompletionItem("SYSDATETIME", CompletionItemKind.Function),
                this.getCompletionItem("SYSUTCDATETIME", CompletionItemKind.Function),
                this.getCompletionItem("SYSDATETIMEOFFSET", CompletionItemKind.Function),
                this.getCompletionItem("CURRENT_TIMESTAMP", CompletionItemKind.Function),
                this.getCompletionItem("DATEADD", CompletionItemKind.Function),
                this.getCompletionItem("DATEDIFF", CompletionItemKind.Function),
                this.getCompletionItem("DATEDIFF_BIG", CompletionItemKind.Function),
                this.getCompletionItem("DATEPART", CompletionItemKind.Function),
                this.getCompletionItem("DATENAME", CompletionItemKind.Function),
                this.getCompletionItem("DAY", CompletionItemKind.Function),
                this.getCompletionItem("MONTH", CompletionItemKind.Function),
                this.getCompletionItem("YEAR", CompletionItemKind.Function),
                this.getCompletionItem("EOMONTH", CompletionItemKind.Function),
                this.getCompletionItem("DATEFROMPARTS", CompletionItemKind.Function),
                this.getCompletionItem("DATETIMEFROMPARTS", CompletionItemKind.Function),
                this.getCompletionItem("DATETIME2FROMPARTS", CompletionItemKind.Function),
                this.getCompletionItem("TIMEFROMPARTS", CompletionItemKind.Function),
                this.getCompletionItem("DATETRUNC", CompletionItemKind.Function),
                this.getCompletionItem("DATE_BUCKET", CompletionItemKind.Function),
                this.getCompletionItem("SWITCHOFFSET", CompletionItemKind.Function),
                this.getCompletionItem("TODATETIMEOFFSET", CompletionItemKind.Function),
                this.getCompletionItem("ISDATE", CompletionItemKind.Function),
                this.getCompletionItem("ISNUMERIC", CompletionItemKind.Function),
                this.getCompletionItem("ISJSON", CompletionItemKind.Function),
                this.getCompletionItem("JSON_VALUE", CompletionItemKind.Function),
                this.getCompletionItem("JSON_QUERY", CompletionItemKind.Function),
                this.getCompletionItem("JSON_MODIFY", CompletionItemKind.Function),
                this.getCompletionItem("JSON_OBJECT", CompletionItemKind.Function),
                this.getCompletionItem("JSON_ARRAY", CompletionItemKind.Function),
                this.getCompletionItem("JSON_PATH_EXISTS", CompletionItemKind.Function),
                this.getCompletionItem("OPENJSON", CompletionItemKind.Function),
                this.getCompletionItem("HASHBYTES", CompletionItemKind.Function),
                this.getCompletionItem("CHECKSUM", CompletionItemKind.Function),
                this.getCompletionItem("BINARY_CHECKSUM", CompletionItemKind.Function),
                this.getCompletionItem("NEWID", CompletionItemKind.Function),
                this.getCompletionItem("NEWSEQUENTIALID", CompletionItemKind.Function),
                this.getCompletionItem("COMPRESS", CompletionItemKind.Function),
                this.getCompletionItem("DECOMPRESS", CompletionItemKind.Function),
                this.getCompletionItem("OBJECT_ID", CompletionItemKind.Function),
                this.getCompletionItem("OBJECT_NAME", CompletionItemKind.Function),
                this.getCompletionItem("OBJECT_DEFINITION", CompletionItemKind.Function),
                this.getCompletionItem("OBJECT_SCHEMA_NAME", CompletionItemKind.Function),
                this.getCompletionItem("SCHEMA_NAME", CompletionItemKind.Function),
                this.getCompletionItem("DB_NAME", CompletionItemKind.Function),
                this.getCompletionItem("DB_ID", CompletionItemKind.Function),
                this.getCompletionItem("SUSER_SNAME", CompletionItemKind.Function),
                this.getCompletionItem("USER_NAME", CompletionItemKind.Function),
                this.getCompletionItem("CURRENT_USER", CompletionItemKind.Function),
                this.getCompletionItem("SESSION_USER", CompletionItemKind.Function),
                this.getCompletionItem("SYSTEM_USER", CompletionItemKind.Function),
                this.getCompletionItem("SCOPE_IDENTITY", CompletionItemKind.Function),
                this.getCompletionItem("IDENT_CURRENT", CompletionItemKind.Function),
                this.getCompletionItem("ERROR_MESSAGE", CompletionItemKind.Function),
                this.getCompletionItem("ERROR_NUMBER", CompletionItemKind.Function),
                this.getCompletionItem("ERROR_LINE", CompletionItemKind.Function),
                this.getCompletionItem("ERROR_PROCEDURE", CompletionItemKind.Function),
                this.getCompletionItem("ERROR_SEVERITY", CompletionItemKind.Function),
                this.getCompletionItem("ERROR_STATE", CompletionItemKind.Function),
                this.getCompletionItem("XACT_STATE", CompletionItemKind.Function),
                this.getCompletionItem("GENERATE_SERIES", CompletionItemKind.Function),
                this.getKeywordCompletionItem("INNER JOIN"),
                this.getKeywordCompletionItem("LEFT JOIN"),
                this.getKeywordCompletionItem("RIGHT JOIN"),
                this.getKeywordCompletionItem("FULL JOIN"),
                this.getKeywordCompletionItem("FULL OUTER JOIN"),
                this.getKeywordCompletionItem("CROSS JOIN"),
                this.getKeywordCompletionItem("LEFT OUTER JOIN"),
                this.getKeywordCompletionItem("RIGHT OUTER JOIN"),
                this.getKeywordCompletionItem("CROSS APPLY"),
                this.getKeywordCompletionItem("OUTER APPLY"),
                this.getKeywordCompletionItem("CREATE TABLE"),
                this.getKeywordCompletionItem("CREATE TABLE AS"),
                this.getKeywordCompletionItem("CREATE VIEW"),
                this.getKeywordCompletionItem("CREATE OR ALTER VIEW"),
                this.getKeywordCompletionItem("CREATE OR ALTER PROCEDURE"),
                this.getKeywordCompletionItem("CREATE OR ALTER FUNCTION"),
                this.getKeywordCompletionItem("CREATE SCHEMA"),
                this.getKeywordCompletionItem("CREATE INDEX"),
                this.getKeywordCompletionItem("DROP TABLE"),
                this.getKeywordCompletionItem("DROP TABLE IF EXISTS"),
                this.getKeywordCompletionItem("DROP VIEW"),
                this.getKeywordCompletionItem("DROP SCHEMA"),
                this.getKeywordCompletionItem("ALTER TABLE"),
                this.getKeywordCompletionItem("TRUNCATE TABLE"),
                this.getKeywordCompletionItem("INSERT INTO"),
                this.getKeywordCompletionItem("DELETE FROM"),
                this.getKeywordCompletionItem("MERGE INTO"),
                this.getKeywordCompletionItem("UPDATE"),
                this.getKeywordCompletionItem("SET"),
                this.getKeywordCompletionItem("VALUES"),
                this.getKeywordCompletionItem("OUTPUT"),
                this.getKeywordCompletionItem("SELECT"),
                this.getKeywordCompletionItem("SELECT TOP"),
                this.getKeywordCompletionItem("FROM"),
                this.getKeywordCompletionItem("WHERE"),
                this.getKeywordCompletionItem("GROUP BY"),
                this.getKeywordCompletionItem("ORDER BY"),
                this.getKeywordCompletionItem("HAVING"),
                this.getKeywordCompletionItem("OFFSET"),
                this.getKeywordCompletionItem("FETCH NEXT"),
                this.getKeywordCompletionItem("ROWS ONLY"),
                this.getKeywordCompletionItem("WITH"),
                this.getKeywordCompletionItem("INTO"),
                this.getKeywordCompletionItem("DISTINCT"),
                this.getKeywordCompletionItem("AS"),
                this.getKeywordCompletionItem("ASC"),
                this.getKeywordCompletionItem("DESC"),
                this.getKeywordCompletionItem("TOP"),
                this.getKeywordCompletionItem("PERCENT"),
                this.getKeywordCompletionItem("WITH TIES"),
                this.getKeywordCompletionItem("AND"),
                this.getKeywordCompletionItem("OR"),
                this.getKeywordCompletionItem("NOT"),
                this.getKeywordCompletionItem("IN"),
                this.getKeywordCompletionItem("BETWEEN"),
                this.getKeywordCompletionItem("LIKE"),
                this.getKeywordCompletionItem("EXISTS"),
                this.getKeywordCompletionItem("IS NULL"),
                this.getKeywordCompletionItem("IS NOT NULL"),
                this.getKeywordCompletionItem("CASE"),
                this.getKeywordCompletionItem("WHEN"),
                this.getKeywordCompletionItem("THEN"),
                this.getKeywordCompletionItem("ELSE"),
                this.getKeywordCompletionItem("END"),
                this.getKeywordCompletionItem("WHEN MATCHED THEN"),
                this.getKeywordCompletionItem("WHEN NOT MATCHED BY TARGET THEN"),
                this.getKeywordCompletionItem("WHEN NOT MATCHED BY SOURCE THEN"),
                this.getKeywordCompletionItem("UNION"),
                this.getKeywordCompletionItem("UNION ALL"),
                this.getKeywordCompletionItem("INTERSECT"),
                this.getKeywordCompletionItem("EXCEPT"),
                this.getKeywordCompletionItem("OVER"),
                this.getKeywordCompletionItem("PARTITION BY"),
                this.getKeywordCompletionItem("ROWS BETWEEN"),
                this.getKeywordCompletionItem("RANGE BETWEEN"),
                this.getKeywordCompletionItem("UNBOUNDED PRECEDING"),
                this.getKeywordCompletionItem("CURRENT ROW"),
                this.getKeywordCompletionItem("PIVOT"),
                this.getKeywordCompletionItem("UNPIVOT"),
                this.getKeywordCompletionItem("TABLESAMPLE"),
                this.getKeywordCompletionItem("ON"),
                this.getKeywordCompletionItem("USING"),
                this.getKeywordCompletionItem("DECLARE"),
                this.getKeywordCompletionItem("BEGIN"),
                this.getKeywordCompletionItem("IF"),
                this.getKeywordCompletionItem("WHILE"),
                this.getKeywordCompletionItem("BEGIN TRY"),
                this.getKeywordCompletionItem("BEGIN CATCH"),
                this.getKeywordCompletionItem("END TRY"),
                this.getKeywordCompletionItem("END CATCH"),
                this.getKeywordCompletionItem("BEGIN TRANSACTION"),
                this.getKeywordCompletionItem("COMMIT"),
                this.getKeywordCompletionItem("ROLLBACK"),
                this.getKeywordCompletionItem("EXEC"),
                this.getKeywordCompletionItem("PRINT"),
                this.getKeywordCompletionItem("RETURN"),
                this.getKeywordCompletionItem("THROW"),
                this.getKeywordCompletionItem("FOR JSON PATH"),
                this.getKeywordCompletionItem("FOR JSON AUTO"),
                this.getKeywordCompletionItem("OPTION (RECOMPILE)"),
                this.getKeywordCompletionItem("WITH (NOLOCK)")
            ]
        );

    }

    getCompletionItem(label: string, kind?: CompletionItemKind): CompletionItem {

        const cased = this.applyCase(label, this.functionCase);
        let completionItem = new CompletionItem(cased, kind);

        const anchor = label.toLocaleLowerCase().replace(/_/g, '-');
        completionItem.documentation = new vscode.MarkdownString(`T-SQL [documentation](https://learn.microsoft.com/sql/t-sql/functions/${anchor}-transact-sql)`);
        completionItem.insertText = new vscode.SnippetString(`${cased}($1)`);
        // Use "1_" prefix to make functions lower priority than columns (which use "0_")
        // Sort on the original label so ordering is stable regardless of case setting
        completionItem.sortText = "1_" + label;

        return completionItem;
    }

    getKeywordCompletionItem(label: string): CompletionItem {
        const cased = this.applyCase(label, this.keywordCase);
        let completionItem = new CompletionItem(cased, CompletionItemKind.Keyword);
        completionItem.insertText = `${cased} `;
        // Use "2_" prefix to make keywords lowest priority (after columns "0_" and functions "1_")
        completionItem.sortText = "2_" + label;
        return completionItem;
    }

    /**
     * Check if user is typing after "alias." or "cteName." and return CTE columns
     */
    getCteColumnsAtPosition(document: TextDocument, position: Position): CteColumn[] {
        // Get text from start of line up to cursor position
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // Check if there's a "word." or "`table`." pattern before the cursor
        // Pattern 1: Simple identifier: word.column or word.
        // Pattern 2: Backtick-quoted: `project.dataset.table`.column or `project.dataset.table`.
        let aliasOrCteName: string | null = null;
        let isBacktickQuoted = false;

        // Qualified name first: [db].[schema].[table]. / schema.table.
        const backtickMatch = textBeforeCursor.match(/((?:\[[^\]]+\]|[A-Za-z_]\w*)(?:\.(?:\[[^\]]+\]|[A-Za-z_]\w*))+)\s*\.\s*([A-Za-z_]\w*)?$/);
        if (backtickMatch) {
            aliasOrCteName = backtickMatch[1];
            isBacktickQuoted = true;
        } else {
            // Try simple identifier pattern: word.
            const match = textBeforeCursor.match(/(?:^|[^\w\]\.])(\[[^\]]+\]|[a-zA-Z_][a-zA-Z0-9_]*)\.\s*([a-zA-Z_][a-zA-Z0-9_]*)?$/);
            if (match) {
                aliasOrCteName = match[1];
            }
        }

        if (!aliasOrCteName) {
            return [];
        }
        const tableName = aliasOrCteName; // TypeScript now knows this is non-null
        const sql = document.getText();

        // If backtick-quoted, it's a direct table reference - look up schema directly
        if (isBacktickQuoted) {
            const tableSchema = this.getPhysicalTableColumns(tableName);
            if (tableSchema.length > 0) {
                return tableSchema;
            }
            return [];
        }

        // Check if this is a CTE name
        const cteNames = getCteNames(sql);
        const matchedCte = cteNames.find(name => name.toLowerCase() === tableName.toLowerCase());
        if (matchedCte) {
            const cols = extractCteColumns(sql, matchedCte);
            return cols;
        }

        // Check if this is a table alias - find what table it refers to
        const tableForAlias = this.findTableForAlias(sql, tableName);
        if (tableForAlias) {
            // Check if it's a CTE
            const cteName = cteNames.find(name => name.toLowerCase() === tableForAlias.toLowerCase());
            if (cteName) {
                const cols = extractCteColumns(sql, cteName);
                return cols;
            }

            // Not a CTE - it's a physical table, try to get schema from cache
            const tableSchema = this.getPhysicalTableColumns(tableForAlias);
            if (tableSchema.length > 0) {
                return tableSchema;
            }
        }

        return [];
    }

    /**
     * Find the table name for a given alias in the SQL
     * Handles patterns like: FROM table_name alias, FROM table_name AS alias
     * Searches from the main query (after WITH block) to avoid matching aliases inside CTEs
     */
    findTableForAlias(sql: string, alias: string): string | null {
        // Find the main query part (after the WITH block if present)
        // Look for the last SELECT/INSERT/UPDATE/DELETE/MERGE that's not inside CTEs
        let mainQuery = sql;

        // Find where CTEs end by looking for the pattern ") SELECT" or similar
        const mainQueryMatch = sql.match(/\)\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\s/i);
        if (mainQueryMatch && mainQueryMatch.index !== undefined) {
            mainQuery = sql.substring(mainQueryMatch.index);
        }

        // Pattern: FROM/JOIN table_name AS alias or FROM/JOIN table_name alias
        // Also handles: project.dataset.table AS alias
        const patterns = [
            // FROM table AS alias or FROM table alias (without AS)
            new RegExp(`\\bFROM\\s+([a-zA-Z0-9_\\[\\]#@.\\-]+)\\s+(?:AS\\s+)?${this.escapeRegex(alias)}\\b`, 'gi'),
            // JOIN table AS alias or JOIN table alias (without AS)
            new RegExp(`\\bJOIN\\s+([a-zA-Z0-9_\\[\\]#@.\\-]+)\\s+(?:AS\\s+)?${this.escapeRegex(alias)}\\b`, 'gi'),
            // Comma-separated: , table AS alias or , table alias
            new RegExp(`,\\s*([a-zA-Z0-9_\\[\\]#@.\\-]+)\\s+(?:AS\\s+)?${this.escapeRegex(alias)}\\b`, 'gi')
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(mainQuery);
            if (match && match[1]) {
                // Clean up the table name (remove backticks)
                return match[1].replace(/[\[\]"]/g, '');
            }
        }

        return null;
    }

    escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Get columns for a physical Fabric SQL table from the schema cache
     * Table name format: project.dataset.table or dataset.table
     */
    getPhysicalTableColumns(tableName: string): CteColumn[] {
        // Parse the table name into parts
        const parts = tableName.replace(/[\[\]"]/g, '').split('.').map(p => p.toLowerCase());

        // Get all cached schemas and find matching table
        // The schema service stores schemas by project_id, dataset_name, table_name
        const allSchemas = (tableSchemaService as any).schemas as any[] || [];

        // Try to find matching schema
        const eq = (a: string, b: string) => (a || '').toLowerCase() === b;
        let matchingSchemas: any[] = [];
        if (parts.length >= 3) {
            const [projectId, datasetName, tableNamePart] = parts.slice(-3);
            matchingSchemas = allSchemas.filter(s => eq(s.project_id, projectId) && eq(s.dataset_name, datasetName) && eq(s.table_name, tableNamePart));
        } else if (parts.length === 2) {
            const [datasetName, tableNamePart] = parts;
            matchingSchemas = allSchemas.filter(s => eq(s.dataset_name, datasetName) && eq(s.table_name, tableNamePart));
        } else {
            matchingSchemas = allSchemas.filter(s => eq(s.table_name, parts[0]));
        }
        if (matchingSchemas.length === 0) {
            return [];
        }

        // Convert to CteColumn format (just need the name)
        const columns: CteColumn[] = [];
        const seen = new Set<string>();

        for (const schema of matchingSchemas) {
            if (!seen.has(schema.column_name)) {
                seen.add(schema.column_name);
                columns.push({ name: schema.column_name });
            }
        }

        return columns;
    }

    /**
     * Check if cursor is in SELECT clause (between SELECT and FROM/WHERE)
     * Returns true if we should show all columns from all tables
     */
    private isInSelectClauseWithoutPrefix(document: TextDocument, position: Position): boolean {
        const textBeforeCursor = document.getText(new vscode.Range(0, 0, position.line, position.character));

        // Check if there's a SELECT keyword before cursor
        const selectMatch = textBeforeCursor.match(/\bSELECT\b/i);
        if (!selectMatch) {
            return false;
        }

        // Get text from last SELECT to cursor
        const textFromSelect = textBeforeCursor.substring(textBeforeCursor.lastIndexOf(selectMatch[0]));

        // Check if there's a FROM/WHERE/GROUP/ORDER/LIMIT between SELECT and cursor
        // If yes, we're NOT in the SELECT clause anymore
        const clauseKeywords = /\b(FROM|INTO|WHERE|GROUP\s+BY|ORDER\s+BY|OFFSET|HAVING)\b/i;
        if (clauseKeywords.test(textFromSelect)) {
            return false;
        }

        // Check if we're right after "SELECT " or "SELECT DISTINCT " or after a comma
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursorInLine = lineText.substring(0, position.character);

        // Pattern: "SELECT " or "SELECT DISTINCT " or ", " or ",\n  "
        const afterSelectPattern = /(?:SELECT(?:\s+DISTINCT)?\s+|,\s*)$/i;

        if (afterSelectPattern.test(textBeforeCursorInLine.trimEnd())) {
            // Check if there's a FROM clause anywhere in the document
            const fullText = document.getText();
            if (/\bFROM\b/i.test(fullText)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Extract all table references from FROM/JOIN clauses in the query
     * Returns list of table names that we can get columns from
     */
    private extractTablesFromQuery(sql: string): string[] {
        try {
            const tableRefs = extractTableReferences(sql);
            return tableRefs.map(ref => ref.name);
        } catch (error) {
            console.error('Failed to extract tables:', error);
            return [];
        }
    }

    /**
     * Get all columns from all tables (deduplicated)
     * Returns columns as completion items ready to insert
     */
    private getAllColumnsFromTables(document: TextDocument, tables: string[]): CompletionItem[] {
        const columns: CompletionItem[] = [];
        const seenColumnNames = new Set<string>();

        const sql = document.getText();

        let sortIndex = 0;
        for (const tableName of tables) {
            // Check if this is a CTE
            const cteNames = getCteNames(sql);
            const matchedCte = cteNames.find(name => name.toLowerCase() === tableName.toLowerCase());

            if (matchedCte) {
                // This is a CTE - get CTE columns
                const cteColumns = extractCteColumns(sql, matchedCte);
                for (const col of cteColumns) {
                    if (!seenColumnNames.has(col.name.toLowerCase())) {
                        seenColumnNames.add(col.name.toLowerCase());

                        const c1 = new CompletionItem(col.name, CompletionItemKind.Field);
                        c1.insertText = col.name;
                        c1.detail = `CTE: ${matchedCte}`;
                        c1.sortText = "0_" + this.pad(sortIndex);
                        columns.push(c1);
                        sortIndex++;
                    }
                }
            } else {
                // This is a physical table - get columns from cache
                const physicalColumns = this.getPhysicalTableColumns(tableName);
                for (const col of physicalColumns) {
                    if (!seenColumnNames.has(col.name.toLowerCase())) {
                        seenColumnNames.add(col.name.toLowerCase());

                        const c1 = new CompletionItem(col.name, CompletionItemKind.Field);
                        c1.insertText = col.name;
                        c1.detail = `Table: ${tableName}`;
                        c1.sortText = "0_" + this.pad(sortIndex);
                        columns.push(c1);
                        sortIndex++;
                    }
                }
            }
        }

        return columns;
    }

    /**
     * Pad number with zeros for sorting
     */
    private pad(num: number | string): string {
        var s = "0000" + num;
        return s.substring(s.length - 4);
    }

}
