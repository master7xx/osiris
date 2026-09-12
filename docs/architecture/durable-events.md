# Durable events and background ingestion

Status: optional writer, readers and collector implemented; deployment verification and later retention/UI stages remain planned. This is the next
backend stage after the shared World Events UI. Default mode uses the process-local ledger; EVENT_READ_MODE=durable opts into database reads.

## Storage decision

Use PostgreSQL for the optional durable deployment. Keep the existing keyless,
single-process setup available until the durable reader and collector pass the
acceptance gates. A JSON snapshot or process-local timer cannot satisfy the
existing audit's restart recovery and concurrent-writer requirements.

The web server and collector are separate processes using the same database.
Native Windows runs both Node processes and connects to native or remote
PostgreSQL. Docker needs a separate collector service and a persistent database
volume; the current standalone web image alone does not run a collector. These
services and configuration are planned, not shipped by this document.

## Records and invariants

| Record | Purpose and constraints |
| --- | --- |
| Store metadata | One row: epoch UUID, committed cursor, earliest retained cursor, schema version |
| Events | Stable UUID, latest canonical payload, material-content hash, revision number, first/last observation, source occurrence time, expiry time |
| Upstream identities | Unique `(source_id, upstream_id)` mapping to a stable event; do not use coordinates as identity |
| Evidence | Source identity, source kind and transport, normalized URL or upstream ID, source time, first/last observation; deduplicate independently of array order |
| Revisions | Immutable full event payload or explicit tombstone, global cursor, event ID, revision number, commit time; unique `(event_id, revision)` |
| Source snapshots | Last successful normalized source output and fetch time, latest attempt/health, next due time and backoff |
| Collector lease | Owner ID, fencing generation, expiry; every batch commit verifies ownership and generation |

Preserve historical evidence on source outages. Freshness of that evidence is
separate from current corroboration: old retained reports must not automatically
increase the current confidence score. Disappearance from the ranked top 300
never deletes an event. Only explicit expiry/removal creates a tombstone.

## Atomic batch write

1. Acquire/renew the collector lease using database time. Perform network I/O
   outside transactions; bound each source request and batch size.
2. Start a transaction and lock the metadata row. Validate the collector's
   fencing generation and lease expiry before mutating event state.
3. Resolve upstream identities against persisted state; apply existing fusion
   and matching rules. Allocate a UUID only for a genuinely new identity.
4. Upsert evidence and source snapshots. Repeated identical observations only
   update observation timestamps; material content changes create revisions.
5. Allocate cursors by updating the locked metadata counter and append revisions
   in the same transaction as the corresponding event updates. Do not allocate
   externally visible cursors before the commit is serialized.
6. Commit event state, evidence, source health, revisions and high-water mark
   together. On rollback, none become visible. Retry transient conflicts using
   an idempotent batch identifier; lease loss rejects late writes.

Row locking is the basis for serializing commits; PostgreSQL documents that
`FOR UPDATE` prevents conflicting row modifications until the transaction ends.
See [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS).
The application must still implement lease fencing and transaction retries.

## Reader and replay contract

Keep `/api/events` as the UI's ranked latest snapshot during rollout. Introduce a
separate versioned changes endpoint rather than silently changing the existing
numeric `since` contract. In durable mode snapshot reads must come from the store
and must never initiate network collection.

A replay cursor is an opaque encoding of `{epoch, after, through}`. The first
page captures a committed high-water mark as `through`; following pages read
immutable revisions where `after < sequence <= through`, ordered ascending.
Once drained, a new poll captures a new high-water mark. Read metadata and rows
from one database snapshot so concurrent ingestion or pruning cannot create an
inconsistent page. Return `has_more` and the last delivered sequence.

Replay is unfiltered: clients apply category/severity/confidence filters to
upserts and remove tombstones. Otherwise an event leaving a filter could remain
stuck in the UI. The latest snapshot may still be filtered server-side.

Expired cursors return HTTP 410 with a reset requirement; a different store epoch
also requires a new bootstrap. Bootstrap must pair the retained current event
set with its high-water mark in one snapshot, independently of the top-300 UI
ranking. Pagination must preserve that bootstrap snapshot until it is consumed.
Initial retention target: seven days of revisions, configurable and documented
before deployment. Pruning is transactional with the retention floor; never
silently skip missing revisions. A restore that rewinds history rotates epoch.

## Collector behavior

Persist per-source schedules and bounded exponential backoff with jitter.
Each adapter may refresh independently; fusion combines the latest successful
source snapshots with explicit age/health, not just the most recent successful
request. Failed sources retain their last successful output marked stale.
Do not hold database locks across provider requests. Shutdown stops scheduling,
finishes or cancels bounded work and relinquishes ownership. A second process
can take over an expired lease; fencing blocks the old process from committing.

## Reviewable implementation sequence

1. Add PostgreSQL migrations, store module and database integration tests:
   atomic revisions, idempotent writes, identity recovery and commit ordering.
2. Add durable snapshot/bootstrap/replay readers, expiry and tombstones. Keep
   the existing UI poller until this contract is proven.
3. Add the independently runnable collector, schedules and lease failover;
   document native Windows and Docker startup and recovery commands.
4. Switch durable-mode API reads to storage, surface collector health in DEBUG,
   then migrate the UI to replay. Retain the legacy mode explicitly during rollout.

## Required acceptance evidence

- Restart both processes: event IDs and cursors remain stable.
- Two writers and a paused stale lease owner cannot commit out of order or
  duplicate a material revision.
- Crash between event update and revision insertion rolls back both.
- Concurrent ingest while paging replay delivers every revision through the
  captured boundary once; later revisions remain for the next poll.
- A source outage preserves stored evidence without claiming fresh coverage.
- Top-300 eviction does not remove history; expiry produces a replay tombstone.
- Retention/restore returns an explicit cursor reset, not silent data loss.
- Collection progresses with all browsers closed and recovers after failures.
- Native Windows CI and a PostgreSQL-backed integration job pass; Docker volume
  restart recovery is checked before advertising durable deployment support.

## Writer foundation delivered

`migrations/events/001_initial.sql`, `tools/migrate-events.mjs` and
`src/lib/durable-event-store.ts` implement transactionally serialized writes,
exact identity aliases, immutable full-payload revisions and retained evidence.
A checksum protects applied migrations. Repeating an identical batch UUID returns
its original result; reusing it for different input fails. Updates use optimistic
revision checks; callers must reload/reconcile after a conflict, not blindly retry
stale payloads. Derived age/ranking changes do not create a revision; future
readers must calculate freshness from observation times.

The next slice adds repeatable-read bootstrap and bounded replay, the standalone
collector, a database-time fenced lease and explicit durable API mode. A Compose
override and native Windows commands are documented in README. Earlier sections
remain the full target contract, not claims that all deployment gates have passed.

Current deviations: bootstrap returns one complete response; no retention pruning
or tombstones; collector schedules source groups together; exact source URL aliases
are reconciled but ambiguous fuzzy merges require manual investigation. Successful
signals persist for 48 hours and can still contribute to fused confidence. Source
health is committed after event writes, so its timestamp may conservatively lag
the newest stored event. Production deployment is not enabled automatically.

## Client cache follow-up

The client now supports server-advertised durable replay, an origin-scoped
versioned localStorage checkpoint and offline/stale display. Checkpoints pair
data with the cursor; multi-page failure leaves the previous pair untouched.
HTTP 410 or a large backlog reboots from a consistent snapshot. Final replay pages
include observation timestamps and ranking metadata for unchanged events. The
server remains authoritative; browser persistence is bounded and disposable.
Retention/tombstones and target-host recovery remain separate rollout work.
