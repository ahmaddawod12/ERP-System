# Tenant database sharding

Smart-Job uses a control database plus a small number of tenant PostgreSQL
shards. It does not create one database per company.

## Boundaries

The control database owns:

- external identity mappings
- the public company ID to tenant shard directory
- active membership projections needed before opening a tenant connection
- provisioning and company-move operation state

Each tenant shard owns complete ERP aggregates:

- companies and authoritative memberships
- subscriptions and module entitlements
- jobs, clients, workers, inventory, and documents
- upload, PDF, email, tax, sync, and archive workflow state that must commit
  atomically with ERP changes

Database connection URLs are injected from Secret Manager. The control database
stores only a secret resource name, never a credential or connection string.

## Request flow

1. The API verifies the identity token or opaque web session.
2. The control database resolves `(user ID, public company ID)` to an active
   membership, internal company UUID, shard ID, and routing version.
3. The API selects a bounded, lazily-created connection pool for that shard.
4. The tenant transaction sets the existing request-local SQL identity context.
5. Tenant SQL re-checks company membership, role, entitlement, and entity
   version before reading or mutating data.

Route entries are cached only briefly. Unknown memberships and unconfigured
shards fail closed.

## Provisioning and moves

Creating or moving a company spans databases and therefore cannot pretend to
be one PostgreSQL transaction. It is an idempotent, resumable operation:

1. reserve an operation and company ID in the control database
2. commit the complete company aggregate in the destination shard
3. activate the control-directory route
4. reconcile safely after any ambiguous failure

Company movement will use the same state machine with a write freeze, verified
copy, route-version switch, and delayed source cleanup. No production move is
enabled by the initial routing foundation.

## Initial rollout

Start with two non-production shards to exercise routing continuously. A first
production release may place all companies on one shard, but every tenant API
path must still resolve through the control directory before adding more
production shards.
