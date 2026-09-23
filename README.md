# Fabric SQL Studio for Visual Studio Code

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/s-seveur.fabric-sql-studio)](https://marketplace.visualstudio.com/items?itemName=s-seveur.fabric-sql-studio) [![Installs](https://img.shields.io/visual-studio-marketplace/i/s-seveur.fabric-sql-studio)](https://marketplace.visualstudio.com/items?itemName=s-seveur.fabric-sql-studio) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Query Microsoft Fabric Warehouses, Lakehouse SQL endpoints, Azure SQL and SQL Server from VS Code. Browse workspaces and catalogs, run T-SQL with your Microsoft account, and work with the results in a grid, charts, notebooks and lineage graphs.

## Features

- **Sign in with Microsoft** - Entra ID through VS Code's built-in Accounts menu, or reuse an `az login` session. No app registration needed.
- **Connections** - Named profiles for Fabric Warehouse / Lakehouse SQL endpoints, Azure SQL and SQL Server. `+` on the explorer picks a Fabric workspace and item from the REST API and writes the profile for you.
- **Explorer** - Connection → database → schema → tables, views, routines from the catalog views. Preview (TOP 100), schema, create query, open definition, copy `[db].[schema].[name]`, pin, search across connections.
- **Run T-SQL** - `Ctrl+Enter` runs the editor (or selection, `Ctrl+E` runs the block under the cursor). A query naming another database in the same or another workspace is routed to the profile that owns it. Multi-statement batches show one grid per result set; DML shows affected rows. Errors land as diagnostics on the reported line.
- **Spark SQL** - `Ctrl+Shift+Enter` runs the selection on a Livy session for the lakehouse you pick with **Select Spark Lakehouse**. The session is reused across runs, its state shows in the Spark sidebar section and the status bar, and **Stop Spark Session** tears it down.
- **Results grid** - Sort, find, schema tab, cell drawer, row selection copy, density, per-type colours, charts. Export CSV / JSONL / clipboard.
- **Notebooks** - Open a `.sql` / `.fsql` file as a notebook: per-cell run, cancel, load-more paging and exports.
- **Language services** - T-SQL completion (keywords, functions, `alias.` columns from `INFORMATION_SCHEMA`), hover schema, semantic tokens, folding, snippets, formatter (`sql-formatter` transactsql dialect with style options).
- **CTE Preview** - CodeLens above each CTE runs it with its upstream CTEs (`SELECT TOP n`).
- **Estimated plan** - `SET SHOWPLAN_XML ON` on the routed connection, rendered as an operator tree with rows, cost and object per operator; raw XML on request. Nothing executes.
- **Column Profile** - Right-click a column: nulls, distinct / duplicate counts, min / max, quantiles, top values.
- **Job History (server)** - `queryinsights.exec_requests_history` on Fabric, `sys.dm_exec_requests` on SQL Server, with request details.
- **Query History** - Local history of everything you ran, re-run and copy.
- **Data lineage** - Sources, CTEs and targets (`INSERT`, `SELECT INTO`, `CREATE VIEW`, `MERGE`, `UPDATE`, `DELETE`) across the file, PNG / PDF export.

## Getting started

1. Install, open the **Fabric SQL** activity bar, click **Sign in with Microsoft**.
2. Click `+` in the explorer to add a Fabric connection (workspace → warehouse / lakehouse / SQL database), or add a profile by hand:

```json
"fabricSql.connections": [
  { "id": "gold-dev", "server": "<guid>.datawarehouse.fabric.microsoft.com", "database": "My_WH" },
  { "id": "onprem", "server": "sql01.corp.local", "port": 1433, "database": "Sales", "kind": "sqlserver" }
],
"fabricSql.activeConnection": "gold-dev"
```

3. Open a `.sql` or `.fsql` file and press `Ctrl+Enter`.
4. For Spark: run **Fabric SQL: Select Spark Lakehouse**, then `Ctrl+Shift+Enter`.

## Settings

All settings live under `fabricSql.*`. The most useful ones:

| Setting | Purpose |
|---|---|
| `connections`, `activeConnection` | Connection profiles and the one bare queries target |
| `authMode`, `tenantId` | `entra-interactive` (default) or `azure-cli`; pin a tenant |
| `maxRows` | Rows kept per result set (default 100000); the grid shows a truncated badge past it |
| `ctePreviewRowLimit` | `TOP n` for CTE previews |
| `format*` | Formatter style (keyword case, indent style, leading commas, expression width, ...) |
| `gridColors` | Per-type cell colours in the grid |
| `clipboardSizeLimitKb` | Cap for "Copy all" |
| `sparkLakehouse` | Workspace and lakehouse Spark SQL runs against |

## Requirements

- VS Code 1.82+
- Outbound TCP 1433 to the SQL endpoint
- For Fabric: a Microsoft account with access to the workspace (Viewer is enough to query; Contributor for `queryinsights`)

## Development

```bash
npm ci
npm run compile      # extension + grid + notebook renderer bundles
npm run test:unit    # mocha unit tests
npm run lint
```

`F5` opens the Extension Development Host on the `tests/` folder, which holds read-only smoke queries.

## Credits

Formerly *BigQuery Studio*, itself a fork of [bstruct/vscode-bigquery](https://github.com/bstruct/vscode-bigquery). The extension has since been retargeted at Fabric and TDS endpoints; no BigQuery code remains.

## License

[MIT](LICENSE)
