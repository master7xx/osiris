# Comprehensive project audit

Audit baseline: `8281093bc2f6e590371b852c7336fab5a2a41b1c`, the shared event cache
branch including PRs #33–37. This report covers that combined working tree, not
just master. No merge or production deployment is implied.

## Scope and evidence

- Inventoried 73 API route handlers, runtime/deployment configuration and test
  entry points. Focused manual review of event collection, durable transactions,
  replay, browser cache, Category filtering, map initialization, CCTV/tile proxies
  and SDK ingestion. This is not a line-by-line security certification of all routes.
- Full local test run after fixes: 68 files passed, 2 skipped; 693 tests passed,
  27 skipped. Dedicated database and live-network checks are separate gates.
- Live-source run: 703 tests passed, 4 failed, 13 skipped. Netherlands, New
  Zealand, Utah and North Carolina CCTV checks timed out or returned no cameras
  after an aborted request. Recheck from the deployment host; this does not prove
  global provider outages.
- TypeScript and targeted lint passed. Full `eslint src tools` exhausted Node's
  4 GiB heap; no clean repository-wide lint result is claimed. CI now records a
  bounded lint inventory separately from enforced test/build gates.
- Dependency audit initially reported 6 production-package findings: 2 critical,
  3 high, 1 moderate. After dependency updates, `npm audit` including development
  packages reported zero known advisories. This is advisory coverage, not proof
  that application code is free of vulnerabilities.
- Windows CI remains the production build/doctor/smoke gate. PostgreSQL CI tests
  transactions/replay/fencing and builds the collector image. Exact run links and
  conclusions are recorded in the audit PR.

## Confirmed findings and corrections

| Priority | Finding | Correction / evidence |
| --- | --- | --- |
| High | Production dependencies fell in known vulnerable ranges | Next 16.3.5, MapLibre 6.9.0 and sharp 0.35.4; patched transitive packages. Vitest 5/Vite 8 and Node 22 types replace the vulnerable development toolchain. |
| High | Camera proxy followed redirects without validating the new host and disabled TLS verification | Validate every target against the provider allowlist and private-address guard; use normal certificate validation, a shared deadline, three-hop limit, 8 MiB frame bound and raster-image content types. Tests reject private redirects and HTML responses. |
| High | Collector truncated fused results to the display limit before writing history | Persist all candidates in bounded batches; only the display projection retains the 300-event cap. Test covers 701 candidates without omissions. |
| High | Reprocessing retained raw signals renewed event observation timestamps | Carry the actual saved source observation into event writes; preserve it on unchanged/repeated reports. Regression test verifies observation time remains unchanged. |
| Medium | Large collections could outlive ownership while preparing/writing batches | Renew the fenced lease during signal storage, candidate preparation and batch commits; reject ownership changes. |
| Medium | Corrupt cached source-health entries could reach render code | Validate source-health records before restoring a cache or projecting a sync response. Regression test rejects null entries. |
| Medium | Numeric cursor maximum used an unbounded spread over event history | Use a reduction instead of expanding all history entries into function arguments. |
| Medium | SDK rejected valid zero coordinates and could fail on null entities | Accept finite zero coordinates, reject out-of-range values and null entries; route test covers these cases. |
| Medium | Tile proxy automatically followed redirects past its initial host check | Reject redirects and validate scheme, credentials and port. |
| Low | Doctor accepted Node 20 while upgraded test dependencies require newer Node | Align doctor and package engines with Node 22.12+, Node 24 or Node 26+. Launch live tests with the Node executable instead of spawning a Windows .cmd shim. |

Selected advisory references:
[MapLibre sanitizer bypass](https://github.com/advisories/GHSA-jrc7-96c5-q579),
[Next.js Windows server advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36).
Applicability depends on enabled features and deployment; no exploit attempt
against the user's server was performed.

## Remaining release gates and limitations

1. **Browser/GPU acceptance.** MapLibre 6 requires WebGL2. The obsolete WebGL1
   fallback is removed. Type-checking cannot verify globe/2D switching, custom
   satellite shaders, camera placement or third-party camera playback. Verify
   these on the user's hardware before merging the major map dependency change.
2. **Provider compatibility.** Cameras with invalid certificates, unusual MIME
   types or redirects to unlisted CDNs will now fail closed. Any exception must
   be narrowed to a verified provider; do not disable TLS globally again.
3. **Durable lifecycle.** History still has no automatic pruning or tombstones;
   bootstrap and observation metadata cover the retained dataset. Large-history
   load and storage growth require target-host measurements. Source groups share
   schedules and retained reports can contribute to confidence within 48 hours.
4. **Atomicity boundaries.** Each event batch is atomic. A collection cycle can
   span batches, with health updated afterward; it is not an atomic whole-world
   snapshot. Ambiguous identities are reported/skipped rather than guessed.
5. **Security hardening.** CSP still allows broad HTTPS/WSS origins and inline/eval
   scripts for existing integrations. The shared DNS guard documents a DNS
   rebinding race because socket-level IP pinning is not implemented. Deployment
   access control, rate limits and externally exposed APIs need host-specific
   review before calling this a hardened public service.
6. **Lint debt.** The full inventory is observational and may exhaust memory/time;
   this audit does not suppress existing rules or claim legacy files are clean.
7. **Real host recovery.** Database volume restore, collector restart with live
   providers and multi-process operational load are not covered by build success.

## Local acceptance commands

From the repository, stop any running dev server first:

```powershell
git fetch origin
git switch fix/comprehensive-audit
git pull --ff-only
npm ci
npm run doctor
npm test
npm run dev
```

Use Node 22.12+ in the Node 22 line, or Node 24. Open localhost:3000 and check the
map, 2D/globe modes, satellites, camera panel with the event dock open, Category
switching and offline cache recovery. Data remain on the server; the browser
cache remains disposable. Database tests need the separate `_test` database
configuration already documented in README. Never use a production database for
those truncating tests.

Windows CI exposed a MapLibre 6 dynamic worker URL incompatibility with Turbopack.
A scoped loader resolves that expression at runtime; predev/prebuild copy the
worker and shared module locally, and the map sets an explicit same-origin URL.
Git checkout cleanup also warns about existing scratch/astra and scratch/mast3r
gitlinks without .gitmodules entries; these pre-existing references were retained.
