# Unified event stream audit and implementation sequence

Audited 2026-09-12 at master `ce7efc6e6bda2b44bb3e27ee0ecb1f6743329f63`.
This is a source-code audit; upstream availability and deployed runtime behavior
have not been verified.

## Existing implementation

`event-feed.ts` combines `event-sources.ts` and `event-signals.ts`, fuses up to
300 events and applies `event-ledger.ts`. `/api/events` and the compatibility
`/api/conflicts` route share this feed. `BreakingNewsMarkers` polls a filtered
snapshot every 90 seconds. Ingest health is exposed to the UI.

The feed has a 45-second process-local cache and shares an in-flight refresh.
The ledger retains identity matching entries for 48 hours in process memory.
It returns only events present in the latest collection, not all retained
entries. Neither state survives a process restart or is shared across workers.
There is no background collector registered in `src/instrumentation.ts`;
that hook currently installs fetch diagnostics only. The checked-in `engine`
directory contains Python bytecode, not maintainable collector source.

## Source inventory

| Source / existing entry point | Unified feed | Remaining work |
| --- | --- | --- |
| News + Telegram (`news-aggregator.ts`) | Core adapter | Preserve original evidence identity across aggregators |
| GDELT DOC (`event-sources.ts`) | Core discovery adapter | Separate from legacy `gdelt-events` ingestion; reconcile coverage |
| GDACS disasters | Core adapter | Legacy `/api/weather` and `/api/gdelt` still fetch separately |
| USGS M2.5+ earthquakes | Core adapter | `/api/earthquakes` still fetches separately |
| NASA EONET | Supplemental adapter | Share retrieval with weather/fire consumers |
| NASA FIRMS VIIRS/MODIS | Supplemental clustered signals | Share retrieval with `/api/fires` without dropping raw hotspot functionality |
| Cloudflare Radar outages | Conditional supplemental adapter | Requires configured credentials; other Radar metrics are contextual |
| NWS active alerts (`/api/weather`) | Missing adapter | Preserve alert IDs, effective/expiry times and source geometry |
| NOAA space weather (`/api/space-weather`) | Missing adapter | Preserve issue time and global/non-geographic scope |
| CISA KEV (`/api/cyber-threats`) | Missing adapter | Represent catalog additions as advisories, not invented located attacks |
| Malware / abuse.ch intelligence | Missing adapter | Define report semantics, provenance and timestamps before ingestion |
| ADS-B aircraft / AIS maritime | Telemetry outside unified feed | Detect explicit incidents or transitions; routine positions are not incident reports |
| Air quality, markets, infrastructure, satellites, CCTV, OSINT lookups | Context / measurements outside unified feed | Define event-producing thresholds or observations separately from raw entity data |

The legacy `/api/cyber-attacks` display uses randomized coordinate offsets and
action labels. Do not reuse its rendered output as evidence of real incidents;
an adapter must consume the original upstream records.

## This change: continuity contract corrections

1. Location, time, classification, description and evidence corrections advance
   the change sequence. Same-length evidence replacements are detected.
   Evidence ordering and ordinary age/priority changes do not create revisions.
2. All concurrent requests use the same stale fallback when collection fails,
   with the existing short retry cooldown and cold-start error behavior.
3. Delta requests are ordered by change sequence. A limited delta page returns
   the last delivered sequence as `cursor` while more matching rows remain,
   rather than skipping directly to the feed high-water mark.

### API contract

- No `since` parameter: existing priority-ranked snapshot behavior is preserved.
- `since=0`: start incremental reading from the available snapshot's beginning.
- `since=N`: read matching changes after N in increasing sequence order.
- `cursor`: continuation value for the next delta request.
- `feed_cursor`: high-water mark of the collected feed.
- `has_more`: more matching rows exist in this snapshot than fit in this page.
- Keep filters unchanged when advancing a cursor. Restart at `since=0` when
  changing filters; previously excluded rows may have older sequence numbers.
- Snapshot requests may be truncated; their cursor is not a pagination token.

This is still a process-local, latest-state delta interface, not a durable
change log. An event can disappear between collections; a restart resets the
cursor. Pagination avoids skips within the available snapshot but cannot promise
replay across refreshes, retention expiry, or process restarts.

## Next implementation sequence

1. **Durable event and revision store.** Persist identity, evidence, revision and
   a globally monotonic cursor atomically; expose a retained change log independent
   of the current top-300 view. Define cursor reset/expiry and deletion semantics.
   Preserve the distinction between source event time and first observation.
   Acceptance: restart recovery, two-worker concurrency, paged replay during
   ingest and partial-source outage without losing earlier evidence.
2. **Background ingestion.** Add a separately runnable collector with per-adapter
   schedules, bounded timeouts, backoff and single-writer ownership. API reads
   stored snapshots. Define deployment for both Windows native and Docker before
   introducing timers into Next workers. Acceptance: collection continues without
   browser traffic and resumes after failure without duplicate revisions.
3. **Remaining report adapters.** Start with NWS and NOAA, then CISA/advisories;
   share existing fetch/parser modules instead of calling this app's HTTP routes.
   Add one source family per reviewable change with provenance fixtures.
4. **Consumer convergence.** Project legacy APIs from shared ingestion while
   preserving raw telemetry where consumers need it. Move live-alert/feed clients
   to durable deltas once replay semantics exist.
5. **Deployment verification.** Measure source freshness, missing intervals,
   false merges, evidence independence and collector recovery on the actual host.

The durable-store implementation needs to match the deployment's persistence
and worker topology; an in-memory timer or local JSON file alone does not resolve
multi-process continuity.
