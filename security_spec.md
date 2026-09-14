# Security Specification & Test Matrix for THDCIL 11 MW Solar Portal

## 1. Data Invariants
1. **Trade Record Invariant**: Every trade record belongs to an authorized plant operator (`userId == request.auth.uid`). A trade must specify a valid date (`YYYY-MM-DD`), valid 15-minute time block (1 to 96), non-negative MCP, and recognized market segment (`G-DAM`, `DAM`, `TAM`, `RTM`).
2. **Settlement Invariant**: Monthly settlements must belong to an authenticated user (`userId == request.auth.uid`), possess valid `status` in `['draft', 'reconciled', 'approved']`, and adhere to strict numerical integrity.
3. **Plant Config Invariant**: Configuration updates must be bounded by valid numerical boundaries (e.g., capacity 11 MW, positive rates) and must be signed by the user UID.
4. **Denial of Wallet & Global Deny**: Catch-all default deny matches `/{document=**}`. Only explicit authenticated owners can read or write their own documents.

## 2. The Dirty Dozen Payloads (Designed to Fail)
1. **Unauthenticated Write**: An unauthenticated client attempts to create or overwrite a trade record in `/trades/t1`. -> PERMISSION_DENIED
2. **Identity Spoofing**: User A attempts to write a trade record with `userId: "user_B"`. -> PERMISSION_DENIED
3. **Ghost / Shadow Field Injection**: User attempts to inject `{ isAdmin: true, bypass: true }` into a trade record or settlement. -> PERMISSION_DENIED
4. **Invalid Block Number**: User attempts to create a trade record with `block: 150` (valid range is 1-96). -> PERMISSION_DENIED
5. **Invalid Market Segment**: User attempts to insert a record with `seg: "UNAUTHORIZED_SEGMENT"`. -> PERMISSION_DENIED
6. **Negative MCP Poisoning**: User attempts to insert a record with negative `mcp: -500`. -> PERMISSION_DENIED
7. **Document ID Poisoning**: User attempts to inject a 2KB junk character or path-traversal string as `{tradeId}`. -> PERMISSION_DENIED
8. **Illegal State Mutation**: Non-owner attempts to update an approved monthly settlement status to "draft". -> PERMISSION_DENIED
9. **Blanket Query Scraping**: User attempts a collection query without filtering by `userId == request.auth.uid`. -> PERMISSION_DENIED
10. **Tampering with Immutable Fields**: User attempts to change `userId` or `date` in an existing trade during an update. -> PERMISSION_DENIED
11. **Config Privilege Escalation**: User attempts to set negative trading fees or excessive capacity > 100 MW. -> PERMISSION_DENIED
12. **PII or Cross-User Data Access**: User A attempts to read trades or settlements created by User B. -> PERMISSION_DENIED
