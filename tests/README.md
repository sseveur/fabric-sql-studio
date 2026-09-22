# Manual test queries

`manual_smoke.bqsql` — read-only queries against the Zimmermann Fabric dev workspaces, one numbered
block per feature to check after F5 (routing, CTE preview / hover / lineage, cross-database join,
multi-result batch, estimated plan, error line number). Each block's comment says what to look at.

Not shipped in the package (`.vscodeignore`). Automated unit tests live in `src/test/unit`.
