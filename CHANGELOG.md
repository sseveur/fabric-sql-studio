# Changelog

All notable changes to Fabric SQL Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-23

First public release.

### Added

- **Entra ID sign-in** - Sign in with a Microsoft account through VS Code's Accounts menu, or reuse an `az login` session (`fabricSql.authMode`, `fabricSql.tenantId`). No app registration needed.
- **Connections and explorer** - Named profiles for Fabric Warehouse / Lakehouse SQL endpoints, Azure SQL and SQL Server. `+` on the explorer picks a workspace and item from the Fabric REST API and writes the profile. The tree shows connection → database → schema → tables, views and routines, with preview, schema, open definition, copy path, pin and cross-connection search.
- **Run T-SQL over TDS** - `Ctrl+Enter` runs the editor, `Ctrl+E` the block under the cursor. Queries naming another database are routed to the profile that owns it. Multi-statement batches render one grid per result set; DML reports affected rows; server errors land as diagnostics on the reported line. Rows are held host-side up to `fabricSql.maxRows` and paged into the grid, so no token crosses into the webview.
- **Spark SQL on lakehouses** - `Ctrl+Shift+Enter` runs the selection on a reusable Livy session for the lakehouse chosen with `Select Spark Lakehouse`. Results land in the same grid, with session state in the sidebar and status bar and a `Stop Spark Session` command.
- **Results grid** - Sort, find, schema tab, cell drawer, row-selection copy, density, per-type colours, charts, and CSV / JSONL / clipboard export.
- **Notebooks** - Open a `.sql` or `.fsql` file as a notebook: per-cell run, cancel, load-more paging and exports.
- **T-SQL language services** - Completion (keywords, functions, `alias.` and three-part column lists from `INFORMATION_SCHEMA`), hover schema, semantic tokens, folding, snippets and a `sql-formatter` transactsql formatter with style options.
- **CTE Preview** - CodeLens above each CTE runs it with its upstream CTEs using `SELECT TOP n`.
- **Estimated plan** - `SET SHOWPLAN_XML ON` on the routed connection, rendered as an operator tree with rows, cost and object per operator; raw XML on request. Nothing executes.
- **Column profile** - Nulls, distinct and duplicate counts, min / max, quantiles and top values for a chosen column.
- **Job history** - `queryinsights.exec_requests_history` on Fabric and `sys.dm_exec_requests` on SQL Server, with request timings and scan volumes.
- **Query history** - Local history of every run, with re-run and copy.
- **Data lineage** - Sources, CTEs and targets (`INSERT`, `SELECT INTO`, `CREATE VIEW`, `MERGE`, `UPDATE`, `DELETE`) across the file, exportable as PNG or PDF.
