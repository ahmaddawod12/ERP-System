# Inventory Module Data Structures

Source of truth: `functions/src/inventory.js`, `functions/src/profile.js`, `website/src/lib/types.ts`, `firestore.rules`.

## Firestore Documents

| Path | Purpose | Key Fields |
| --- | --- | --- |
| `companies/{companyId}/data/inventory` | Shared company stock | `parts[]`, `nextId`, `lastUpdated` |
| `users/{uid}/data/inventory` | Personal stock | `parts[]`, `nextId`, `lastUpdated` |
| `users/{uid}/data/cache` | Personal inventory invalidation | `inventory`, `lastUpdated` |
| `companies/{companyId}/data/cache` | Company-level cache update | `updatedAt` (and summary fields used elsewhere) |
| `companies/{companyId}/inventory_picks/{pickId}` | Reserved path in rules | no active writer in current repository |

## `InventoryPart` Shape

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `number` | Primary part id inside `parts[]` |
| `name` | `string` | Part label |
| `active` | `boolean` | Mostly relevant for company inventory visibility |
| `quantity` | `number` | Quantity in stock |
| `lowThreshold` | `number` | Threshold alerting value |
| `dateAdded` | `string` | ISO timestamp string |
| `sourcePartId` | `number` | Optional, used when personal inventory is populated via pick flow |

## API Contract: `updateInventoryV1`

| Action | Required Inputs | Behavior |
| --- | --- | --- |
| `addPart` | `companyId`, `scope`, `partName` | Appends part and increments `nextId` |
| `removePart` | `companyId`, `scope`, `partId` | Removes part from `parts[]` |
| `togglePart` | `companyId`, `scope`, `partId` | Toggles `active` |
| `updatePart` | `companyId`, `scope`, `partId`, optional value fields | Updates mutable part fields |
| `pickParts` | `companyId`, `scope=company`, `targetUid`, `partsToPick[]` | Validates company stock, deducts company quantities, merges/adds into personal inventory |
| `replaceParts` | `companyId`, `scope`, `parts[]` | Sanitizes and replaces full array |

## Access Rules (High-Level)

| Scope | Who Can Mutate |
| --- | --- |
| `scope=company` | manager/dev (solo scope also supported by backend checks) |
| `scope=user`, `targetUid=self` | authenticated app roles allowed by backend checks |
| `scope=user`, `targetUid!=self` | manager/dev only, with same-company verification |
