import { ObjectRef, qualifiedName } from './objectRef';

/** T-SQL snippets the explorer commands open or run. */
export class QueryGeneratorService {

    static generateSelectQuery(ref: ObjectRef, top = 100): string {
        return `SELECT TOP ${top}\n\t*\nFROM ${qualifiedName(ref)};`;
    }

    static generatePreviewQuery(ref: ObjectRef, top = 100): string {
        return `SELECT TOP ${top} * FROM ${qualifiedName(ref)}`;
    }

    static generateSchemaQuery(ref: ObjectRef): string {
        const db = qualifiedName({ ...ref, schema: undefined, name: undefined });
        return `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT\n` +
            `FROM ${db}.INFORMATION_SCHEMA.COLUMNS\n` +
            `WHERE TABLE_SCHEMA = N'${lit(ref.schema)}' AND TABLE_NAME = N'${lit(ref.name)}'\n` +
            `ORDER BY ORDINAL_POSITION`;
    }

    /** Views, procedures and functions have a stored definition; tables do not. */
    static generateDefinitionQuery(ref: ObjectRef): string {
        return `SELECT OBJECT_DEFINITION(OBJECT_ID(N'${lit(qualifiedName(ref))}')) AS definition`;
    }
}

function lit(s: string | undefined): string {
    return (s ?? '').replace(/'/g, "''");
}
