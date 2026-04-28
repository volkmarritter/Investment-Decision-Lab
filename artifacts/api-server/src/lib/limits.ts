// ----------------------------------------------------------------------------
// limits.ts
// ----------------------------------------------------------------------------
// Server-side mirror of the per-bucket alternatives cap that the
// front-end exports from artifacts/investment-lab/src/lib/etfs.ts.
//
// We can't TS-import that constant because the api-server reads
// etfs.ts as text (catalog parser) rather than as a module — pulling
// it in would drag the whole front-end runtime (overrides, picker
// helpers, JSON imports) into the server bundle. So we maintain the
// number in two places. If you change one, change the other:
//
//   artifacts/investment-lab/src/lib/etfs.ts  → MAX_ALTERNATIVES_PER_BUCKET
//   artifacts/api-server/src/lib/limits.ts    → MAX_ALTERNATIVES_PER_BUCKET (this file)
//
// Used by:
//   • routes/admin.ts  — single-add and bulk-add preflight gates that
//     refuse a new alternative when the parent bucket is already full.
//   • lib/github.ts    — the injectAlternative() helper that performs
//     the same gate before mutating the catalog file in the PR branch,
//     and the bulk-PR reviewer-checklist body.
// ----------------------------------------------------------------------------
export const MAX_ALTERNATIVES_PER_BUCKET = 10;
