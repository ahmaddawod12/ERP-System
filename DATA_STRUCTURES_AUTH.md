# Auth Module Data Structures

Source of truth: `functions/src/auth.js`, `functions/src/profile.js`, `functions/src/invites.js`, `functions/src/tax.js`, `firestore.rules`.

## Firestore Documents

| Path | Purpose | Key Fields |
| --- | --- | --- |
| `users/{uid}/data/profile` | Canonical user profile | `uid`, `email`, `role`, `companyId`, `name`, `phoneNumber`, `accountType`, `wid` (workers), `mid` (managers), `createdAt`, `updatedAt`, `pushToken*` |
| `users/{uid}/data/cache` | User cache counters | `profile`, `inventory`, `subscription`, `lastUpdated` |
| `companies/{companyId}/workers/{wid}` | Company membership doc (keyed by wid) | `uid`, `wid`, `role`, `email`, `name`, `phoneNumber`, `createdAt`, `updatedAt` |
| `companies/{companyId}/counters/wnext` | Worker ID counter | `next` |
| `companies/{companyId}/counters/mnext` | Manager ID counter | `next` |
| `companies/{companyId}/counters/cnext` | Client ID counter | `next` |
| `companies/{companyId}/counters/jnext` | Job ID counter | `next` |
| `companies/{companyId}/data/business_info` | Business registration data | `he_name`, `en_name`, `vat_number`, `business_type`, `city`, `address`, `document_numbers`, `last_updated` |
| `companies/{companyId}/data/subscription` | Tier and module gates | `tier`, `status`, `enabledModules`, `expiresAt`, `updatedAt` |
| `companies/{companyId}/data/cache` | Company cache summary | `jobsVersion`, `documentsVersion`, `clientsVersion`, `workersVersion`, `updatedAt` |
| `companies/{companyId}/invites/{inviteId}` | Invite code doc | `code`, `targetRole`, `status`, `createdBy`, `createdAt`, `expiresAt`, `usedBy`, `usedAt` |
| `companies/{companyId}/data/token` | Tax Authority token storage | `accessToken`, `refreshToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `callbackId` |
| `taxAuthPending/{authId}` | Pending OAuth state | `state`, `stateNonce`, `companyId`, `uid`, `status`, `expiresAt` |
| `taxAuthCallbacks/{authId}` | OAuth callback and exchange result | `code`, `used`, `tokenExchangeSuccess`, `tokenExchangeError`, `accessTokenExpiresAt` |
| `system/data/comid` | Global company ID allocator | `comid`, `updatedAt`, `lastAllocatedCompanyId`, `lastAllocatedBy` |

## API Contracts

| Function | Type | Main Inputs | Main Writes |
| --- | --- | --- | --- |
| `registerBusinessV1` | Callable | `role`, `accountType`, profile fields, business fields | profile, user cache, company root, workers, business info, subscription, inventory, company cache, counter docs (`wnext`, `mnext`, `cnext`, `jnext`), `system/data/comid` |
| `manageWorker` | Callable | `action=add/edit/delete`, `companyId`, `email`, optional password and role fields | auth user, worker profile (`wid` assigned), worker cache, workers membership (keyed by wid), company counters/cache |
| `updateProfileV1` | Callable | `name?`, `phoneNumber?` | `users/{uid}/data/profile` and mirror update to `companies/{companyId}/workers/{wid}` |
| `updatePushTokenV1` | Callable | `pushToken`, `pushTokenPlatform?`, `pushTokenType?` | push token fields on profile |
| `clearPushTokenV1` | Callable | none | deletes push token fields from profile |
| `updateBusinessInfoV1` | Callable | `companyId` + editable business fields | business info doc + company cache `updatedAt` |
| `updateCacheV1` | Callable | `field`, `isCompanyCache`, `companyId?`, `targetUid?`, `action` | user or company cache doc |
| `createInviteV1` | HTTP `POST` | `companyId`, `targetRole` | invite doc with generated code and expiry |
| `joinCompanyV1` | HTTP `POST` | `companyId`, `inviteCode`, `email`, optional role/name/phone | invite status, worker membership, profile, company workers cache |
| `requestUpgradeV1` | HTTP `POST` | `requestedTier`, `currentTier`, `message` | `upgrade_requests/{id}` |
| `contactRequestV1` | HTTP `POST` | `name`, `email`, `company`, `message` | `contact_requests/{id}` |

## Notes

- `business_info` uses snake_case naming.
- `vat_number` and `document_numbers` are blocked from `updateBusinessInfoV1`.
- `companyId` is backend-assigned from `system/data/comid`.
