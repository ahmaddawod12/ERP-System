# Batch 5 large-tenant profile

Measured on 2026-07-21 against the repository-owned local PostgreSQL
stack. The profiler creates one tenant inside a transaction, inserts 100,000
jobs, 50,000 documents, 20,000 inventory parts, and a deliberately extreme
1,200-segment archive month, warms each query once, runs it 20 times, and rolls
the fixtures back. The archive fixture protects the mobile/API pagination path
from regressing to the removed 1,000-item assumption.

Targets are p95 below 300 ms for list queries and below 500 ms for search.

| Query | Baseline p95 | Indexed p95 | Target | Result |
| --- | ---: | ---: | ---: | --- |
| Jobs list | 3.04 ms | 2.53 ms | 300 ms | Pass |
| Jobs search | 958.70 ms | 7.33 ms | 500 ms | Pass |
| Documents list | 2.00 ms | 2.55 ms | 300 ms | Pass |
| Documents search | 133.03 ms | 47.08 ms | 500 ms | Pass |
| Inventory search | 44.68 ms | 9.16 ms | 500 ms | Pass |

The baseline job search exceeded its budget and justified the generated,
normalized search columns and `pg_trgm` GIN indexes in the consolidated baseline.
Document and inventory indexes use the same bounded query pattern and add
headroom while avoiding multiple per-row lowercase/substring calculations.
The tradeoff is additional index storage and write amplification; the list
queries and composite cursor indexes are unchanged.

Re-run with:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
$env:DATABASE_SSL_MODE = "disable"
npm --prefix packages/db run perf:large-tenant
```

The script rejects non-loopback databases and always rolls its transaction
back, including after a failed assertion or query.
