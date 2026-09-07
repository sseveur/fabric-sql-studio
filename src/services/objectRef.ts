/**
 * Object identity for the SQL Server / Fabric targets. No vscode import — shared by host,
 * webview and unit tests.
 *
 * A database object is addressed by connection + database + schema + name. The string form
 * (`ObjectRefKey`) is what goes into settings (pinned objects) and the table index:
 *
 *   "<connection id>/<database>.<schema>.<name>"
 *
 * Parts containing `.`, `/`, `[` or `]` are bracket-quoted in the key, `]` doubled as in T-SQL.
 */
export type ConnKind = 'sqlserver' | 'fabric';

export interface ConnectionRef {
    /** Stable profile name; the settings key and the refKey prefix. */
    id: string;
    server: string;
    database: string;
    port?: number;
    kind?: ConnKind;
}

export type ObjectKind = 'connection' | 'database' | 'schema' | 'table' | 'view' | 'routine';

export interface ObjectRef {
    conn: string;
    database?: string;
    schema?: string;
    name?: string;
    kind: ObjectKind;
}

export type ObjectRefKey = string;

const NEEDS_QUOTE = /[.\/\[\]]/;

export function bracket(part: string): string {
    return `[${part.replace(/]/g, ']]')}]`;
}

function quoteIfNeeded(part: string): string {
    return NEEDS_QUOTE.test(part) ? bracket(part) : part;
}

/** `[db].[schema].[name]` — always fully quoted, safe to paste into a FROM clause. */
export function qualifiedName(ref: ObjectRef): string {
    return [ref.database, ref.schema, ref.name].filter((p): p is string => !!p).map(bracket).join('.');
}

/** `db.schema.name` — unquoted unless a part needs it. */
export function displayName(ref: ObjectRef): string {
    return [ref.database, ref.schema, ref.name].filter((p): p is string => !!p).map(quoteIfNeeded).join('.');
}

export function refToKey(ref: ObjectRef): ObjectRefKey {
    return `${ref.conn}/${displayName(ref)}`;
}

/** Lower-cased key for matching: SQL Server names are case-insensitive by default collation. */
export function refKeyCI(ref: ObjectRef): string {
    return refToKey(ref).toLowerCase();
}

export function sameRef(a: ObjectRef, b: ObjectRef): boolean {
    return refKeyCI(a) === refKeyCI(b);
}

/** Splits `a.[b.c].d` into ['a', 'b.c', 'd']. */
export function splitDotted(path: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let inBracket = false;
    for (let i = 0; i < path.length; i++) {
        const ch = path[i];
        if (inBracket) {
            if (ch === ']') {
                if (path[i + 1] === ']') { cur += ']'; i++; } else { inBracket = false; }
            } else {
                cur += ch;
            }
        } else if (ch === '[') {
            inBracket = true;
        } else if (ch === '.') {
            parts.push(cur); cur = '';
        } else {
            cur += ch;
        }
    }
    parts.push(cur);
    return parts;
}

export function parseKey(key: ObjectRefKey, kind: ObjectKind = 'table'): ObjectRef | null {
    const slash = key.indexOf('/');
    if (slash <= 0) { return null; }
    const conn = key.slice(0, slash);
    const parts = splitDotted(key.slice(slash + 1)).filter(p => p.length > 0);
    if (parts.length === 0) { return { conn, kind: 'connection' }; }
    const [database, schema, name] = parts;
    return { conn, database, schema, name, kind: parts.length === 1 ? 'database' : parts.length === 2 ? 'schema' : kind };
}
