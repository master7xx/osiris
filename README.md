# OSIRIS

**Open Source Intelligence & Reconnaissance Integrated System**

[![Windows native CI](https://github.com/master7xx/osiris/actions/workflows/windows-native.yml/badge.svg)](https://github.com/master7xx/osiris/actions/workflows/windows-native.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

OSIRIS is a global situational-awareness dashboard built with Next.js,
TypeScript and MapLibre. It combines a unified world-event feed with aviation,
maritime, CCTV, environmental and OSINT views. This repository supports native
Windows development and a Docker standalone build.

[Issues](https://github.com/master7xx/osiris/issues) ·
[Pull requests](https://github.com/master7xx/osiris/pulls) ·
[Event architecture audit](docs/unified-event-audit.md) ·
[Durable-store architecture and rollout](docs/architecture/durable-events.md)

## Current capabilities

| Area | Implementation |
| --- | --- |
| World events | Shared ingest, normalization, fusion, evidence, severity, priority and continuity metadata through `/api/events` |
| News and Telegram | Parallel RSS and public Telegram preview collection, headline deduplication, source health and location extraction |
| Conflicts | `/api/conflicts` projects the shared feed into the existing `zones` and `liveEvents` response; zone anchors provide context and do not create offset event coordinates |
| Natural hazards | USGS earthquakes, GDACS disasters, EONET events and clustered FIRMS fire detections in the shared feed |
| Internet outages | Cloudflare Radar outage events when credentials are configured |
| Aviation and maritime | ADS-B/OpenSky aircraft data, AIS vessel tracking with an API key, and port/chokepoint context |
| CCTV | Regional provider adapters, coverage diagnostics, adaptive fallback, USGS volcano cameras and optional Windy enrichment |
| Weather and space | Weather alerts, NOAA space weather, satellite positions from orbital data and orbit visualization |
| OSINT and cyber | Domain/IP/DNS/CVE and sanctions lookups, wallet intelligence, malware/threat views and optional external services |
| Diagnostics | Browser/API debug overlay, upstream timing correlation, news/CCTV/event source health |

Coverage and freshness depend on the provider, credentials, network access and
selected layer. Camera catalogue entries and static context are not a guarantee
of a working live stream or a newly observed incident. Live broadcast streams are
separate from the article-based world-event feed.

## Quick start: native Windows

Use Node.js 22.12 or newer within the Node 22 line to match Windows CI and the
Docker image; Node 24 is also supported. The test toolchain no longer supports
Node 20. Install Git and use a browser with WebGL2 support (required by MapLibre 6).

From PowerShell:

```powershell
git clone https://github.com/master7xx/osiris.git
cd osiris
npm ci
npm run doctor
Copy-Item .env.example .env.local
npm run dev:windows
```

Open [http://localhost:3000](http://localhost:3000). `dev:windows` binds to
`0.0.0.0`; use `npm run dev -- -H 127.0.0.1` to bind only to localhost.
The web application does not require WSL or Docker on Windows.

On a POSIX shell, use `cp .env.example .env.local` and `npm run dev` after cloning
and installing dependencies. Optional services and provider credentials can be
configured later; the public world-event adapters do not require API keys.

For a production build on the local machine:

```sh
npm run build
npm start
```

See [WINDOWS.md](WINDOWS.md) for native development and debugging details.

## Dashboard layout

The desktop dashboard now uses a docked shell with a compact UTC/API header,
an expandable layer navigation, a persistent location search and a news panel
that can be hidden. The map resizes when panel widths change. The selected camera viewer stays
inside the available map area, including when the event panel is open; its
expanded view uses the same bounds. Existing map tools
remain on the right-hand tool strip; layer keys, URL restoration and Style Studio
settings are retained. The `L` shortcut still hides/shows the layer navigation.

Navigation starts expanded at 1440 px and above and compact on smaller desktops.
Below 1024 px, side panels overlay the map and opening one closes the other.
The existing phone layout remains in use. Panel close buttons restore focus to
the corresponding header control; Escape closes a focused side panel.

The right panel and phone event panel now use one `/api/events?limit=300`
snapshot shared with map markers. Category, minimum severity, confidence and
located-only filters apply to both views. Category choices stay stable across
refreshes; a category with no events shows an empty list, and changing filters
returns the list to its beginning. Clicking a card locates a reliably
positioned event; clicking its marker selects the card and opens the panel.
Unlocated events stay in the list. Expanded cards show supporting sources;
severity and corroboration confidence remain separate fields. All sources use the
same card typography (13 px message text, 11 px metadata). Severity badges show
low (<35), medium (35–69) and high (70+) with different icons and text. Source
badges distinguish Telegram, BBC, broadcasters, editorial, official and sensor
sources; mixed-source events retain a badge for each source.

The client synchronizes every 90 seconds while visible, on visibility return and
on network reconnection. In durable mode it loads one bootstrap and then revision
pages; default mode continues to fetch full snapshots. Failed refreshes retain the last snapshot; partial source coverage and
snapshots older than three minutes are labelled. Selection and filters survive
refreshes and panel close/reopen within the page. The latest-state API remains
capped at 300 events and does not provide durable history.

DEBUG offers a SIZE button cycling between near-full-screen, half and one-third
height, with compact views anchored at the bottom.
See [shell implementation notes](docs/dashboard-shell.md) for the changes and
remaining browser validation, and [PR #31](https://github.com/master7xx/osiris/pull/31)
for the proposed full interface plan.

## Unified world-event architecture

```mermaid
flowchart TD
    Core["News, Telegram, GDELT, GDACS, USGS"] --> Collect["Parallel source collection"]
    Extra["EONET, FIRMS, optional Radar"] --> Collect
    Collect --> Fusion["Normalize, deduplicate, combine evidence"]
    Fusion --> Ledger["Process-local continuity ledger"]
    Ledger --> Feed["Shared cached feed"]
    Feed --> Events["/api/events"]
    Feed --> Conflicts["/api/conflicts projection"]
    Events --> UI["World-event map and ingest health"]
```

The main modules are:

| Module | Responsibility |
| --- | --- |
| [`event-sources.ts`](src/lib/event-sources.ts) | Core adapter registry and source health |
| [`event-signals.ts`](src/lib/event-signals.ts) | Supplemental hazard and outage adapters |
| [`event-fusion.ts`](src/lib/event-fusion.ts) | Event schema, classification, title/time/location matching and evidence aggregation |
| [`event-ledger.ts`](src/lib/event-ledger.ts) | Stable identity across refreshes, material changes, lifecycle and sequence numbers |
| [`event-feed.ts`](src/lib/event-feed.ts) | Collection orchestration, shared in-flight request and snapshot cache |
| [`conflict-projection.ts`](src/lib/conflict-projection.ts) | Compatibility projection for conflict consumers |

### Connected sources

| Adapter | Input | Configuration |
| --- | --- | --- |
| News + Telegram | RSS publishers and public `t.me/s/` previews | Curated registry in [`news-aggregator.ts`](src/lib/news-aggregator.ts); no Telegram token |
| GDELT DOC | Global article-discovery queries | Public endpoint |
| GDACS | Multi-hazard RSS | Public endpoint |
| USGS | M2.5+ earthquakes over the past day | Public GeoJSON |
| NASA EONET | Open natural events | Public endpoint |
| NASA FIRMS | VIIRS/MODIS detections clustered into signals | Public CSV feeds |
| Cloudflare Radar | Outage annotations | `CLOUDFLARE_API_TOKEN`; adapter enabled only when set |

The news registry includes BBC, Guardian, Al Jazeera and Euronews RSS alongside
editorial and OSINT Telegram channels. Edit the registry to change this set;
the current aggregator does not read `OSIRIS_TELEGRAM_CHANNELS`.

Events carry source evidence and URLs, category, occurrence/observation times,
optional coordinates, location confidence, severity and priority. Fusion uses
heuristics and has stricter matching for nearby earthquakes. Confidence values
are `unconfirmed`, `corroborating` and `confirmed`; they reflect configured
source weights and evidence rules, not human verification. Official or sensor
evidence can produce `confirmed` without a second report.

### Continuity and failure behavior

- The shared feed caches snapshots for 45 seconds and coalesces concurrent refreshes.
- The ledger keeps identity entries for 48 hours **in process memory**. It returns
  the current collection, not an archive of every retained event.
- Events expose `id`, `fused_id`, `first_observed_at`, `last_observed_at`,
  `changed_at`, `update_count`, `change_sequence` and a lifecycle of `new`,
  `updated` or `ongoing`.
- Corrections to coordinates, report time, classification or evidence advance
  the sequence. Evidence reordering and ordinary freshness/priority changes do not.
- Partial source failures allow healthy sources to contribute. When a refresh
  fails entirely, concurrent readers receive the last successful snapshot if
  one exists, with a short retry cooldown. Its generation time remains old.
- The shared world-event client polls every 90 seconds and requires coordinates
  with sufficient location confidence. Events without usable coordinates can
  remain in the API feed.

**Default mode is request-driven and process-local.** Restarts reset its
identity state and cursors; separate workers have separate state. Its snapshot is
capped at 300 fused events and may lose events absent from later collections.
The [optional durable pipeline](#optional-durable-event-pipeline) adds PostgreSQL
history and an independent collector through explicit configuration.

## Event API

Examples:

```text
/api/events?mappable=1&minSeverity=35&limit=80
/api/events?category=earthquake&limit=50
/api/events?since=0&limit=100
/api/conflicts
```

| Parameter | Behavior |
| --- | --- |
| `category` | Filter by one supported category |
| `minSeverity` | Minimum severity, clamped to 0–100; default 0 |
| `mappable=1` | Require coordinates and location confidence of at least 0.75 |
| `limit` | Page size, clamped to 1–300; default 200 |
| `lifecycle` | `new`, `updated` or `ongoing` |
| `since` | Changes after this sequence; an explicit `since=0` starts delta reading |

Categories: `conflict`, `protest`, `political`, `earthquake`, `flood`, `wildfire`,
`volcano`, `weather`, `cyber`, `infrastructure`, `aviation`, `maritime`, `other`.
A category in the schema does not imply that all relevant sources are integrated.

Without `since`, results preserve priority order. With `since`, results are
ordered by increasing `change_sequence`. Use the returned `cursor` for the next
delta request while `has_more` is true. `feed_cursor` identifies the full feed's
high-water mark. Keep filters fixed while advancing a cursor; restart from zero
when changing filters. A limited ordinary snapshot's cursor is not a pagination
token.

This supports paging through changes available in a snapshot, **not durable
replay** across refreshes or restarts. Responses also include source health,
source counts, generation time and aggregate category/confidence/lifecycle counts.
Aggregate counts describe the whole feed; `total` describes the returned page.
See the [audit](docs/unified-event-audit.md) for the complete current contract.

Other APIs remain available for specialized consumers, including `/api/news`,
`/api/live-news`, `/api/earthquakes`, `/api/fires`, `/api/weather`, `/api/flights`,
`/api/maritime`, `/api/cctv`, `/api/satellites` and `/api/osint/*`.
`/api/gdelt-events` reads GDELT geocoded event exports; the legacy `/api/gdelt`
route reads GDACS despite its name. These are distinct from GDELT DOC discovery.
Some specialized routes still collect their sources separately.

## Configuration

Use [`.env.example`](.env.example) as a starting point and keep credentials in
`.env.local` for native Next.js runs, or `.env` for the Docker examples below.
The template contains legacy options; the table below describes active integrations.

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Radar layers and the optional unified outage adapter |
| `AIS_API_KEY` | Live aisstream.io vessel positions |
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | OpenSky OAuth credentials for aviation collection |
| `WINDY_WEBCAMS_API_KEY` | Optional Windy webcam enrichment |
| `SCANNER_URL`, `SCANNER_KEY` | Optional scanner-backed operations; independent OSINT routes have their own implementations |
| `ETHERSCAN_API_KEY`, `HELIUS_API_KEY` | Additional wallet-intelligence enrichment |
| `ASTRA_GPU_URL` | Optional external ASTRA service; route default is `http://localhost:8000` |
| `UMAMI_BASE_URL`, `UMAMI_WEBSITE_ID` | Optional analytics; leave unset for native installs without Umami |
| `OSIRIS_DEBUG=1` | Enable upstream diagnostics in a production run |
| `OSIRIS_PORT` | Host port substitution in Docker Compose; default 3000 |

The current unified FIRMS adapter uses public CSV, not `FIRMS_API_KEY`.
The satellite route uses CelesTrak/SatNOGS orbital data rather than `N2YO_API_KEY`.
Missing credentials affect the corresponding integration; keyless sources can
also fail or rate-limit independently.

## Docker

To build this repository's web app without the optional Compose services:

```sh
docker build -t osiris:local .
```

Create `.env` from `.env.example` (`Copy-Item` in PowerShell or `cp` in a POSIX
shell), configure any required integrations, then run:

```sh
docker run --name osiris -d -p 3000:3000 --env-file .env osiris:local
```

The Dockerfile uses Node.js 22, a Next.js standalone build and a non-root runtime.
The image built locally reflects this checkout; an upstream project's prebuilt
image may contain different code.

The checked-in [`docker-compose.yml`](docker-compose.yml) additionally includes
an nginx cache and an intel service, requires an existing external network named
`umami_default`, and points analytics at `umami-umami-1`. Configure those deployment
assumptions before using `docker compose up -d --build`. The direct Docker command
above runs only the web application. Container restarts do not preserve the current
in-memory event ledger.

## Diagnostics and validation

Open the DEBUG overlay with **Ctrl+Shift+D** or the DEBUG control. It shows API
status, duration, correlation IDs and upstream timings. Browser and server
histories are bounded and kept in memory; diagnostic exports omit query strings,
request bodies and credentials. The **SIZE: FULL / 1/2 / 1/3** button changes the
window height without clearing filters or the log. Small screens use a minimum
usable height; the selected size is retained when closing and reopening DEBUG
until the page reloads. Upstream collection is enabled in development;
production collection requires `OSIRIS_DEBUG=1`.

Source health views help distinguish errors and partial results. Latency is
reported as a diagnostic, not by itself as an event-source health penalty.
`/api/health` is the runtime smoke endpoint; a successful response does not verify
all external providers.

```sh
npm run doctor
npm test
npm run build
npm run smoke:windows
```

The [Windows native workflow](.github/workflows/windows-native.yml) runs these
checks after `npm ci` using Node.js 22. `npm run smoke:windows` requires a completed
production build and starts a temporary server on port 3107. Live-network tests
are opt-in through the cross-platform `npm run test:live`. Additional local checks
are `npx tsc --noEmit` and `npm run lint`.

## Next work and documentation maintenance

The next steps are target-host recovery verification, history retention and
tombstones, independently scheduled sources, additional report adapters, and
further consumer convergence. Durable replay-based UI updates and CISA cyber
advisories are implemented.
The PostgreSQL writer, readers and collector are implemented as an optional mode;
production rollout and the remaining work are not claimed complete. The
[architecture audit](docs/unified-event-audit.md) records the original baseline,
and the [durable contract](docs/architecture/durable-events.md) tracks current
implementation limits and acceptance criteria.

Update this README in the same PR as changes to behavior, APIs, source coverage,
configuration, setup or deployment. Keep implemented behavior separate from plans,
verify commands and paths against the code, and update linked documentation when
its instructions change. Repository guidance is recorded in [AGENTS.md](AGENTS.md).

## License and origin

MIT; see [LICENSE](LICENSE). This repository continues work from
[simplifaisoul/osiris](https://github.com/simplifaisoul/osiris).
Provider data, imagery and streams retain their own terms and attribution.

## Optional durable event pipeline

PostgreSQL migrations, transactional writes, bootstrap/replay readers and a
separately runnable collector are implemented. Default mode remains the existing
request-driven pipeline. Set `EVENT_READ_MODE=durable` explicitly to make
`/api/events` and `/api/conflicts` read the database without collecting upstreams.
A database or collector failure does not silently switch back to live ingestion.

Use PostgreSQL 17, the integration CI target. Create a database and save these
settings in the repository's `.env.local`:

```dotenv
EVENT_DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/osiris_events
EVENT_READ_MODE=durable
```

Apply migrations once (and when a later update adds migrations), then start:

```powershell
node --env-file=.env.local tools/migrate-events.mjs
npm run dev
```

`npm run dev` and `npm run dev:windows` now start both Next.js and the collector
in one terminal when `EVENT_READ_MODE=durable`. Both receive Next's development
environment-file settings; existing shell variables take precedence. Missing
`EVENT_DATABASE_URL` in durable mode fails before either process starts. Snapshot
mode starts only Next.js. Extra arguments, such as `npm run dev -- --port 3001`,
are forwarded only to Next.js. Restart the command after changing environment
settings. Stop any previously launched standalone collector before using this.

Ctrl+C stops the session and its child processes; an unexpected child exit stops
the other process and returns a failing exit code. Windows uses `taskkill /T /F`
to include Next's workers. PostgreSQL remains running. Wait for the collector's
first successful commit; until then durable reads report unavailability.
Migrations remain explicit, transactional and checksum-checked. Production
`npm start`, Docker and the standalone `events:collect` command are unchanged;
no collection timer runs inside Next.js.

- `/api/events/stored` returns all retained current records and a consistent
  opaque replay cursor. It also exposes the last collector success and a sanitized
  collector error; raw database/provider exception messages are not returned.
- `/api/events/changes?cursor=TOKEN&limit=100` returns unfiltered immutable revisions,
  ordered by cursor. Pages retain a fixed upper boundary during concurrent ingest;
  after the final page the next request starts a new polling boundary.
- Invalid/expired cursors or an epoch mismatch require bootstrap (HTTP 410).
- The existing numeric `since` API remains latest-state compatibility only;
  durable replay uses the separate opaque cursor endpoint.

The collector runs core and supplemental adapters together every ~90 seconds,
with bounded exponential backoff on failure. Successful raw signals remain for
48 hours to survive missing-source responses. Database-time leases and fencing
reject writes from expired owners. Ambiguous identities are skipped and reported
in collector status. Completed source checks are saved even if all sources fail or
later event processing fails; the last successful feed timestamp is preserved.
Durable clients keep received events and show a refresh error on failed collection,
clearing it after recovery. Successful cycles with identity skips remain warnings.
Expired or superseded workers cannot overwrite the collector outcome.
Exact identity lookups use batches of at most 300 unique source keys rather than
one query per candidate. Candidate order and conflict skipping are preserved;
leases are renewed between batches and writes still validate revisions and ownership.
Sources still use existing adapter timeouts; independent
per-source schedules and automatic fuzzy reconciliation remain future work.
Historical evidence stays separate from the current event payload, but retained
signals may still contribute to confidence within the observation window.

For Docker, set a strong URL-safe `EVENT_DB_PASSWORD` (for example a random hex
string) in `.env`, then:

```bash
docker compose -f docker-compose.yml -f compose.events.yml up --build -d
```

The override adds PostgreSQL with a persistent volume and a collector service,
and enables durable reads in the web service. Existing base Compose prerequisites
still apply, including its external `umami_default` network. Do not delete the
`event-data` volume to restart services. Native Windows may use a native or remote
PostgreSQL installation without Docker. Docker deployment has not been exercised
in this workspace; verify on the target host before switching production.

Database tests require a **dedicated disposable database ending in `_test`**:

```powershell
$env:EVENT_TEST_DATABASE_URL = "postgres://USER:PASSWORD@localhost:5432/osiris_events_test"
npm run test:event-store
```

Tests truncate event-store records in that test database. Ordinary `npm test`
skips database integration without this variable; CI supplies PostgreSQL.

The database suite includes 60 simulated observation cycles with a retained
report during missed polls, source recovery, a new writer connection/lease owner,
and one corrected report. It checks stable event identities and replay cursors:
unchanged observations update freshness without adding event revisions. This is
a database regression test, not a long-running live-provider soak test.

Storage still grows: each committed batch adds an idempotency receipt to
`osiris_events.batches`, including unchanged batches. New events and material
corrections add revisions. Neither receipts nor revision history are pruned
automatically; the collector's 48-hour signal cleanup does not bound total
database size. Do not delete receipts or revisions manually while relying on
batch retry or replay guarantees.

Remaining limits: bootstrap is a single response; event/revision history has no
automatic pruning or tombstones yet. The UI uses replay in durable mode and ranked snapshots in default mode. Explicit expiry, per-source schedules, replay-based UI and measured
host recovery remain rollout work. See the [architecture contract](docs/architecture/durable-events.md).

## Client event cache and synchronization

Authoritative data, revisions and source collection remain on the server.
The browser keeps a disposable localStorage checkpoint containing events and the
opaque replay cursor together. On reload it displays that checkpoint as
`CACHED DATA`/`STALE` until server synchronization succeeds. Failed refreshes
retain the previous checkpoint. Filters and selection stay in page state.

The cache is scoped to the browser origin, schema-versioned, expires after seven
days and is capped at roughly 4 MiB of UTF-16 text. Quota failures, blocked storage
and corrupt data fall back to in-memory operation without breaking live updates.
Clearing site data removes this cache, not server history.

`/api/events/sync` advertises the server's active mode without exposing database
configuration. In durable mode the first load uses `/api/events/stored` and later
polls use `/api/events/changes`. Every page is applied by stable event ID, keeping
the newest sequence. The client advances its saved cursor only with the matching
data. HTTP 410 replaces both from a fresh bootstrap. A backlog exceeding 20 pages
also uses bootstrap. A durable server outage never silently enables request-driven
source collection. The server sends compact observation/priority metadata with
final pages so unchanged reports do not disappear merely because they have no new
revision. The displayed durable view filters out observations older than 48 hours
and ranks up to 300 matches locally; retained history remains on the server.

Verification: reload after a successful sync, simulate offline, change Category,
then reconnect. Cached rows should remain usable and clearly labelled; reconnect
must catch up without duplicate cards. Cursor-reset and interrupted-page behavior
also have automated tests. There is no cross-tab live synchronization yet; each
tab owns its poller and persists complete checkpoints independently.

## Comprehensive audit follow-up

The audit updates Next.js, MapLibre, sharp and the test toolchain to versions
outside the advisory ranges reported for the previous lockfile. MapLibre 6
requires WebGL2; the older WebGL1 fallback is removed. See
[the audit report](docs/comprehensive-audit.md) for tested scope and remaining gates.

The durable collector now saves all fused candidates in bounded transactions,
not only the UI's top 300. Events retain the latest actual upstream observation
time when stored signals are reprocessed. Ownership is renewed during large
batches. UI ranking remains capped at 300 events. Multiple transactions can become
visible before collector health is updated; this is not a whole-cycle atomic snapshot.

Camera image proxy redirects are revalidated against the provider allowlist,
private-address checks remain enabled, TLS certificates are verified and image
responses are bounded to 8 MiB. Invalid certificates and non-image responses now
fail closed. Tile proxy redirects are rejected. Provider compatibility still
requires a live camera check on the deployment host.

MapLibre workers are served locally from `/vendor/maplibre/`; `predev` and
`prebuild` copy the worker and its shared module from the locked dependency.
The scoped Turbopack loader handles MapLibre 6’s dynamic worker URL expression.

Distance and area readouts use consistent English numeric formatting (for
example `4,200 km` and `12.50 km²`) regardless of operating-system locale.

### Category views and previous reports

WORLD EVENTS filters the complete client checkpoint before applying the 300-card
display limit. In snapshot mode `/api/events/snapshot` supplies a complete feed;
durable mode continues to use stored events and cursor synchronization. Switching
Category reads the existing cache immediately while the normal background refresh
continues. Previously received snapshot reports stay available for up to 48 hours
from their last observation and are marked `Cached previous report` when absent
from the latest response. A new report with the same ID replaces its cached copy.

The category summary and expandable `Sources in this view` follow the visible
cards and filters. `PARTIAL SOURCES (GLOBAL)` describes collector availability
across all categories; changing a display filter cannot change that global health.
All databases remain on the server. Browser cache is disposable and subject to
the existing storage quota; a large checkpoint can remain memory-only.

Long event cards show a three-line title and six-line description preview.
`Read full text / Читать полностью` expands the original plain text independently
of map selection; `Collapse / Свернуть` restores the preview. Paragraphs and
common digest bullets retain line breaks. Source badges remain outside the preview.

An explicit roundup label plus multiple list items marks a probable digest.
Such reports are labelled `Digest · Multiple reports` and are not assigned a
single map position, including when read from an older client cache. They are
not automatically split into separate incidents; this conservative heuristic is
not a complete semantic classifier. Ordinary long reports remain individual events.

Camera JPG loading is labelled `SOURCE SNAPSHOT` / `IMAGE LOADED · UNVERIFIED`.
A successful image request can contain an operator outage placeholder and does
not prove camera availability or recording. Placeholder-image recognition is
not implemented; the operator's notice remains visible in the supplied image.

The desktop shell keeps labelled `Layers` and `Events` controls in its header.
Collapsed or hidden panels also expose an edge button to reopen them. `Events`
controls WORLD EVENTS / SOURCES; the duplicate `Alerts` toolbar button is removed.
The left navigation's `Threat layers` group controls map layers, not the event
feed. Narrow desktop layouts show one expanded side panel at a time.

Event report IDs derive from source and upstream URL rather than position in a
refresh result. Cached snapshot aliases are reconciled using exact source/URL
provenance, and the shared card/marker projection also removes old aliases.
Distinct URLs are not merged merely because titles look alike. Place matching
uses word boundaries to avoid matching Aden inside unrelated words; Leipzig is
recognized explicitly. Existing persisted location metadata is corrected by a
subsequent successful source refresh, not a database rewrite.

### NOAA / NWS warning adapter

The shared collector and snapshot feed now ingest NOAA/NWS active U.S. warnings
through the same fetch helper used by `/api/weather`. No internal HTTP calls or
browser database are added. Official source links, CAP message IDs, descriptions
and instructions are retained. Flood warnings use `flood`; other warnings use
`weather` (a fire-weather warning is not a detected wildfire). Test/exercise messages and malformed timestamps are excluded. Cancellation
and expired update messages with explicit references are retained as lifecycle
records; they do not appear as active warning cards. Distinct NWS message IDs do not fuzzy-merge with one another.

Only supplied Point geometry qualifies for a precise map marker. Polygon area
representatives have lower location confidence; warnings without geometry remain
in the list. `expires:` metadata hides expired warnings from the shared client
view even offline, while server history is retained. Explicit CAP references suppress superseded warnings and early cancellations
in the current feed, including restored client caches. Active warnings plus the
last 48 hours of messages are fetched with bounded pagination and a shared
deadline per collection. Failure of either collection preserves the previous
checkpoint rather than publishing an incomplete refresh. An absent warning
without an explicit cancellation remains until its declared expiry. NOAA SWPC space-weather bulletins use their own adapter (below).

Protocol reference: [NWS API documentation](https://www.weather.gov/documentation/services-web-api).

NWS lifecycle records preserve `supersedes` source URLs and `withdrawn` state
through fusion, event revisions and client checkpoints. Lifecycle is applied
before Category filtering and the display limit; cancelled reports remain in
server history. Old clients must refresh to use these semantics. Outages longer
than the 48-hour replay window require a fresh snapshot; this is not a guarantee
of full historical CAP-chain reconstruction.


### NOAA / SWPC space-weather bulletins

The common feed ingests the last seven days of SWPC bulletins in `weather`, tagged
`space-weather`, with official provenance and no invented ground coordinates.
The legacy `/api/space-weather` endpoint shares the alerts fetcher; Kp and flare
products remain in that endpoint. Source health reports failed/invalid collections.
NOAA issue timestamps are interpreted as UTC. Message code plus serial number
identifies a report (issue timestamp is the fallback); the latest correction wins.
Explicit `evidence.upstream_id` takes precedence over collection URLs in fusion,
server collection and client deduplication. Distinct bulletins never fuzzy-merge.

This is bulletin history, not a registry of currently effective warnings:
cancellations remain clearly titled notices; they do not remove earlier bulletins.
Severity maps explicit NOAA G/R/S scale levels to OSIRIS scores, with a neutral
fallback for unscaled messages. The global stream has no map markers. Existing
clients must refresh; durable installations must update their server collector.

Source: [NOAA SWPC alerts feed](https://services.swpc.noaa.gov/products/alerts.json).


### Space-weather measurement availability

`/api/space-weather` maps Kp 5/6/7/8/9 to G1/G2/G3/G4/G5 using the
[NOAA scale](https://www.spaceweather.gov/noaa-scales-explanation).
Missing, malformed and out-of-range Kp values return `kp_index: null` and
`storm_level: "Unknown"`; a measured zero remains valid. The HUD and Markets
panel display a dash for missing Kp. Valid products remain usable during a
partial upstream outage. `data_status` is `available`, `partial` or `unavailable`,
with booleans in `availability` for `kp`, `alerts` and `solar_flares`. Consumers
must inspect these fields even on HTTP 200. Valid empty alert/flare collections
mean available with no entries. These flags describe response availability,
not timestamp freshness; `kp_timestamp` remains the provider's timestamp.


### Finding space weather in the dashboard

On desktop, open **Markets** with the chart icon on the map's right toolbar
or press **M** (English keyboard layout, outside a text field). **SPACE WEATHER**
is beneath **BREADTH** in the docked panel. Markets uses an opaque theme surface
so map labels do not bleed through. The space-weather heading, measurement and
flare text use readable, wrapping typography. Partial/unavailable responses
identify the missing products. A missing Kp remains a visible neutral Unknown,
not a dim severity color. This block appears after the space-weather response loads.


### Geolocation and news retry behavior

`/api/geo` normalizes IPv4-mapped IPv6, including Windows loopback
`::ffff:127.0.0.1`, and omits local/private or malformed inputs from provider
URLs. Only 172.16–172.31 are treated as private in the 172.x range. Responses
include `lookup_scope`: `client-ip` for a supplied public address, or
`server-egress` when providers auto-detect the server's external address.
The latter is not a claim about the browser user's physical location. Deployments
must configure trusted proxy headers correctly. Valid zero latitude/longitude
is accepted; invalid coordinates fall through to the next provider. Providers
can still fail, in which case the endpoint returns 502.

RSS/Telegram fetches use at most two attempts, each with its own 6.5-second
timeout. A timed-out signal is never reused. Retried HTTP 5xx response bodies
are released; HTTP 4xx is not retried. Two timeout failures can therefore take
about 13 seconds, plus processing/scheduling overhead. This fixes ineffective
retry attempts; it does not eliminate external network outages or guarantee
that all event sources are healthy.


### Snapshot recovery and source status

If every source fails, the snapshot endpoint retains the previous event data
and its `generated_at` timestamp, but publishes the failed refresh's source
health rather than the previous healthy count. `refresh_error` and
`refresh_attempted_at` identify a failed refresh even on HTTP 200. These fields
survive client projection and cache reload; the panel marks the data cached/stale
and displays the failure. A successful refresh clears the failure metadata.
Unexpected collection errors likewise mark current health unavailable.

Category source lists describe the provenance of displayed reports, including
retained reports. Global health describes source availability at collection time.
Debug request errors are historical: they can remain after current health recovers.
Client retention does not renew an event's observation clock. Durable-mode
storage and its synchronization protocol are unchanged by this snapshot fix.


### CISA KEV advisories in world events

CISA KEV is shared by `/api/cyber-threats` and the common event collector.
Entries added in the last 30 days appear in `cyber` as **catalog additions**,
with vendor/product, description, required action and CISA due date. The event
date is `dateAdded`, normalized to UTC midnight with day precision; it does not
claim an attack happened at that time. Advisories have no invented coordinates.

CVE is the explicit upstream report identity: different CVEs sharing the catalog
URL remain separate, and updated entries revise the same report. Source health
marks failed/malformed collections as unavailable, including count mismatches
or duplicate CVEs. Event priority uses OSIRIS scores 70, or 80 when CISA reports
known ransomware use; these are not CVSS ratings. Unknown ransomware use does
not mean no ransomware use. Catalog additions older than 30 days are outside
this adapter's refresh window; absence is not a withdrawal or proof of remediation.
The legacy endpoint retains its existing response fields and ten-item limit.
Durable installations must update the server collector; no migration is needed.

Schema: [CISA's official KEV schema](https://github.com/cisagov/kev-data/blob/develop/known_exploited_vulnerabilities_schema.json).

### Large-response cache and camera retry behavior

The stats endpoint reads flight and satellite responses with `no-store`
to avoid inserting multi-megabyte payloads into Next.js Data Cache. CCTV uses
existing coverage metadata without fetching a camera response. The compact
stats response also uses `no-store`. Camera source caching remains independent. Failed camera fetches wait 60 seconds after failure before retrying,
even when no previous camera index exists; an existing index is preserved.
Upstream timeouts and invalid provider payloads still report source errors.

### Request middleware and Netherlands camera collection

Request correlation and optional Umami forwarding retain `src/middleware.ts`.
The proxy migration is deferred after API 404s during target-host development
verification; the deprecation warning remains until that migration is validated.
Netherlands camera loads from Europe enrichment and direct regional requests
share the RWS source cache and in-flight request within a server module instance.
This does not deduplicate across separate processes or guarantee a single log
line across development reloads.

The USGS Ashcam adapter accepts its observed `{ "webcams": [...] }` response
envelope as well as the legacy array. Unexpected envelopes remain source errors.
This fixes catalog parsing, not the availability or freshness of individual images.

Windows CI checks `/api/health` and `/api/events/sync` for successful JSON
responses in both development and production modes. After changing between
proxy and middleware branches, stop the dev session and remove only the generated
`.next` directory before restarting. This does not remove environment files,
PostgreSQL records or browser caches.

### Stats without camera loading

`/api/stats` no longer calls `/api/cctv`. It reads the last global camera coverage
snapshot already produced by a normal camera request in the same server process.
`stats.cctv` is `null` before any such snapshot exists, not zero. Regional snapshots
do not replace the global count. `cctv_snapshot.state` is `cached` or `unavailable`,
and `observed_at` is the camera snapshot time, not the stats response time. This
count describes the returned catalog snapshot, which may have partial source
coverage; it is not a count of currently working video streams. After a process
restart or on another instance it can be unavailable until cameras are loaded.

The compact stats response uses `no-store` so an unavailable count is not held
in an HTTP cache. Other counters still fetch their existing APIs and can delay
the response; no fixed latency is promised. Removed the dashboard's unused stats
request/state: displayed layer counts already come from its other data paths.

### Markets maritime context without internal HTTP

`/api/markets` reads a small process-local chokepoint projection published by
completed `/api/maritime` responses; it no longer requests that endpoint or starts
vessel ingestion. `scm_snapshot` reports `cached`, `stale` (older than two minutes),
or `unavailable`, with the original response time. Stale/missing snapshots produce
no SCM alerts, which does not mean maritime risk is absent. A normal maritime
request refreshes this context; another instance or a restarted server may lack it.
The timestamp describes calculation time, not the age of every vessel position.
Existing chokepoint heuristics and price collection remain unchanged.

### Read-only event-store size report

Run on the server with the existing database configuration:

```powershell
node --env-file=.env.local --import tsx tools/event-store-status.ts
```

The JSON report includes per-table allocated bytes (including indexes/TOAST),
planner row estimates, estimated dead rows, replay boundaries and collector status.
Counts can be stale or unavailable until PostgreSQL analyzes tables. Sizes can
change during ingestion and do not indicate how much disk cleanup would reclaim.
Numeric sizes/cursors are strings to avoid JavaScript integer precision loss.
It uses a read-only transaction, statement/lock timeouts, indexed revision
boundaries and catalog estimates instead of full history counts. No collection,
backup, deletion, VACUUM or migration runs. Two reports taken at different times
can show allocated growth; one report does not predict a growth rate.

Collector diagnostics also include `category`, `level` and `skipped_candidates`.
The legacy `has_error` flag still means a stored non-null message, including a
warning after a successful cycle. `identity_reconciliation` with `level: warning`
identifies a completed cycle that skipped candidates; its count is a decimal
string, not the number of lost events. Failed reconciliation has `level: error`
and an unknown count (`null`). Other recognized categories are
`revision_conflict`, `sources_unavailable` and `collector_ownership`.
Unrecognized errors are `unclassified`; raw messages, source payloads and
connection details are never returned. A null saved message yields `category`
and `level` of `none`, which does not establish source completeness or liveness.
These fields describe the last stored message, not a new health probe; lease
inactivity can be normal between cycles. No migration or collector restart is
needed for this report enhancement. Existing stored messages are classified
without being rewritten, so older collectors are supported.

### CelesTrak group diagnostics

Satellite responses expose `celestrak_health` for the last group refresh, with
group name (or supplemental FILE), HTTP status when available, observation time,
record count and errors. HTTP 200 without TLE records is an error. A disk-cache
restore has no saved health observations until a refresh. GLONASS uses the
provider's `glo-ops` group. Invalid `tle-new` and `GROUP=supplemental` queries are
not requested; SupGP Starlink keeps its separate `FILE=starlink` endpoint.
`last-30-days` is omitted from TLE ingestion: its current six-digit catalog
entries require modern GP formats. This is a coverage limitation, not a claim
that the group itself does not exist.

Within one server module lifetime, concurrent requests share pending group loads
and reuse results for two hours. Transport failures also wait two hours. HTTP
errors and unusable HTTP 200 payloads suspend that group's automatic retries
(`retry_suspended: true`) until server restart after operator investigation.
Restart resets this in-memory protection; it is not a way to bypass provider
limits. Multiple server processes do not share the gate. See the
[CelesTrak usage policy](https://celestrak.org/usage-policy.php).

An entirely failed refresh does not renew the satellite cache timestamp. Partial
refreshes backfill old elements. Each satellite exposes `tle_received_at`, the
receipt time of its own data, preserved during backfill; legacy disk records and
the emergency fallback return null. Receipt time is not the orbital epoch or a
guarantee of accuracy. Reusing a group response does not renew its receipt time.

`tle_format_limited: true` explicitly identifies the current legacy-format limit:
TLE cannot cover new six-digit NORAD numbers. OMM/JSON ingestion is not yet
implemented; a healthy group response does not establish catalog completeness.

### Read-only identity conflict report

```powershell
node --env-file=.env.local --import tsx tools/identity-conflict-report.ts
```

Reconstructs fusion from the retained 48-hour signal window, then applies the
collector's ordered identity skip rules against a read-only database snapshot.
`multiple_stored_events` means one candidate links to several persisted events;
`repeated_stored_event` identifies a later candidate targeting an already accepted
event, with `earlier_accepted_position` referencing the zero-based candidate order.
Links include source IDs, SHA-256 identity fingerprints, stored event UUIDs and
revisions. Raw upstream IDs/URLs, titles and event payloads are omitted. Hashes
are correlation keys, not anonymization. No upstream requests, migrations, writes,
merges or cleanup occur. This is a reconstruction, not the previous cycle's trace:
new signals, fusion time and row ordering can change its results. An empty report
does not prove historical conflicts have been resolved. The command refuses more
than 10,000 signals or 100,000 distinct identities rather than silently truncating
the analysis; SQL statements have 10-second and lock waits 2-second limits.

### Hazard fusion identity boundaries

Fusion keeps distinct adapter event IDs from the same USGS or GDACS provider
separate, including when titles, locations or collection URLs match. Updated
observations with the same adapter ID can still fuse. A cluster cannot bypass
this boundary via an intervening report from another source. These guards use
the IDs already present in retained adapter signals; durable identity keys are
unchanged. Without an exact report match, earthquake fusion now requires known
positions within 25 km and occurrence times within 15 minutes; title similarity
alone is insufficient. Cross-source matching remains heuristic, not proof of
identity. Existing digest/withdrawal and explicit-report rules still apply.

This prevents further grouping of distinct provider events. It does not split
previously merged database records, reassign identities, delete history or fix
existing repeated-target conflicts. The read-only identity conflict report may
therefore show more separate candidates still targeting an old merged record.
Review those links before any historical reconciliation.

### Dry-run identity reconciliation proposals

```powershell
node --env-file=.env.local --import tsx tools/identity-reconciliation-plan.ts
```

Extends the conflict report with `reconciliation` (`mode: dry-run`,
`executable: false`). For affected stored UUIDs it reads every persisted identity,
including keys absent from the retained 48-hour signals. Verified adapter IDs
(USGS ID or GDACS type + numeric event ID) group repeated observations. Distinct
IDs from one provider can produce `propose_split_for_review` only if every stored
key maps unambiguously to a retained provider ID. Missing historical observations,
shared keys, synthetic GDACS IDs and cross-provider correspondence block proposals.
News conflicts remain manual review. These rules do not prove physical-event
identity; source semantics and historical payloads still require review.

Partitions expose public provider event IDs and hashed identity keys. Proposed
moves use stable `new-event:` symbolic references, not allocated UUIDs. The
original event/history would need preservation with explicit supersession; no
apply CLI is exposed by this report. The plan
includes snapshot epoch/cursor and expected event revisions for future validation,
but it must never be applied against a changed snapshot. At most 100,000 stored
identity links are inspected; exceeding the bound fails rather than truncates.
No migrations, collection, camera changes, retention or cleanup run.

### Reviewed split implementation

The dry-run now includes source titles, times and coordinates for each partition,
and the current parent plus up to three latest historical revision summaries.
This is a limited review aid, not a complete historical audit. `payload_hash`
identifies the current parent payload, including changes that do not bump revision.

`applyReviewedSplit` is the single-parent transaction wrapper. The explicit package
CLI reuses its transactional core; no API or collector applies repairs. It accepts reviewed child payloads/identity partitions
and an exact document checksum. A checksum is not authorization or proof that
source matching is correct. Dry-run proposals are not accepted as executable input.
No production records have been split by this work.

The primitive locks replay metadata and requires the reviewed epoch, cursor,
parent revision/payload hash, complete disjoint identity coverage and no active
collector lease. It creates children, moves identities, appends the parent's
`replaced_by` revision, and commits the cursor and operation receipt together.
Failures roll back all writes. Identical operation IDs/documents return the prior
result; changed reuse is rejected. Original evidence and all historical revisions
remain. Current durable feeds hide `replaced_by` parents; raw storage/replay still
contains them. Browser synchronization publishes all pages as one checkpoint and
also hides replaced parents during bootstrap. Camera behavior is unchanged.

Before enabling application: review source semantics and full relevant history,
construct reviewed child payloads, stop the collector, verify a fresh snapshot,
and validate the apply workflow in PostgreSQL CI. Use the explicit package workflow
below; `tools/identity-reconciliation-plan.ts` remains read-only.

Reconciliation proposals also include `pair_reviews` for nearby hazard reports,
including pairs attached to different historical parents. Earthquake reports
within 25 km / 15 minutes and wildfire reports within 25 km / 24 hours require
manual review; these are conservative screening thresholds, not proof of a
shared event. Possible USGS/GDACS confirmations are identified without merging
or separating their evidence. Any affected group has no proposed identity moves
until reviewed. Missing coordinates cannot establish proximity, and an empty
pair review is not approval to execute a split. This remains a read-only report.

### Fixed reconciliation snapshot

Export once while PostgreSQL is reachable; the web server and collector need not
be running. Pass earlier reports to preserve their affected event IDs even when
observations have left the 48-hour window. The export uses a single repeatable-read,
read-only transaction and includes retained analysis inputs, all identity links
for affected parents, current parent payloads and their full revision history.
For affected identities it also reads matching observations outside the 48-hour
window, preserving their actual observation times. It cannot recover deleted rows.
`observation_coverage` distinguishes `in_window`, `outside_window` and
`not_found_in_signal_store`; the latter does not establish why a row is absent.
`signal_count` still describes the live window; `analysis_signal_count` includes
historical matches. Live conflict counts are not a full historical audit.
Limits (10,000 signals / 100,000 links / 100,000 revisions) fail the export instead
of silently truncating it. The snapshot is local diagnostic data, not a DB backup;
it contains source text and URLs, so share the generated review rather than the snapshot.

```powershell
node --env-file=.env.local --import tsx tools/identity-reconciliation-snapshot.ts export identity-snapshot.json identity-reconciliation-review.json identity-reconciliation-review-v2.json
node --import tsx tools/identity-reconciliation-snapshot.ts replay identity-review-fixed.json identity-snapshot.json
```

Both commands write UTF-8 directly and refuse to overwrite an existing output.
Replay requires no database connection and uses the frozen inputs without current
time. It verifies the format, algorithm version and checksum. Missing parent
identity links appear in `unresolved_event_ids`, except parents with a saved
`replaced_by` marker and no remaining identity links, listed in `superseded_events`.
This classification does not reverify their children (use package `verify` for that).
Old snapshots remain readable but replay cannot add observations absent from the file.
Missing observations remain
blockers. Keep the snapshot with the matching code version. Checksums detect
accidental modification, not authenticity or authorization. Snapshot export and
replay do not change database rows.

### Preserve historical identity review holds

Snapshot exports also retain semantic pair findings from supplied previous reports.
`historical_pair_reviews` records the original pair, distance, time difference and
report time. A group remains blocked by `historical_pair_requires_review` even if
new provider coordinates/time no longer trigger proximity checks, or its counterpart
has no remaining observations. Missing-observation blockers alone are not permanent:
newly available observations can resolve them. Already superseded parents remain
separately classified; no historical hold authorizes a new split.

To enrich an existing local snapshot without accessing PostgreSQL:

```powershell
node --import tsx tools/identity-reconciliation-snapshot.ts annotate identity-snapshot-with-history.json identity-history-snapshot.json identity-review-fixed.json
node --import tsx tools/identity-reconciliation-snapshot.ts replay identity-review-with-history.json identity-snapshot-with-history.json
```

The original snapshot is preserved; output files must not exist. Use the enriched
snapshot for subsequent package building so historical holds are also excluded from
split packages. New exports/replay use `hazard-pair-review-v2`; v1 snapshots remain
readable by the new code, but old tooling cannot read newly created v2 snapshots.
Only supplied reports can contribute prior findings. These read-only tools have no
automatic or command-line override for clearing semantic holds; resolution requires
a separately reviewed change. Previous split packages are not altered or reapplied.

### Concrete split package and read-only preflight

Use the existing fixed snapshot to build proposed child payloads and exact identity
moves offline. Blocked groups remain excluded. Child evidence must cover precisely
its assigned stored identities, with no dropped or overlapping keys. The package
preserves the parent payload hash, revision, epoch and snapshot cursor.

```powershell
node --import tsx tools/identity-split-package.ts build identity-snapshot.json identity-split-package.json
node --env-file=.env.local --import tsx tools/identity-split-package.ts check identity-split-package.json identity-split-check.json
```

Build needs no database. Check uses a repeatable-read, read-only transaction and
reports changes to metadata, parent payloads/revisions, identity links or an active
collector lease. Stop `npm run dev` for a quiet preflight; PostgreSQL must remain
available. Both commands write UTF-8 and refuse to overwrite existing files.
Keep the package locally (it contains source evidence); share `identity-split-check.json`,
which includes proposed titles, locations, times and blockers without raw source URLs.

`database_matches_package` only describes this point-in-time comparison. It is not
approval or permission to mutate data. Snapshot v1 lacks persisted per-signal
observation timestamps; proposed children explicitly have `observed_at: null` and
application must obtain verified observation times rather than substitute discovery
time. The explicit apply command repeats transactional checks and advances the cursor
for each split inside one transaction. Parent history remains intact.

The package `check` command also verifies per-child source observation times
against persisted `signals.observed_at`. It rebuilds each child at the fixed
snapshot time and compares its payload (independent of JSON object key order)
with the proposed child. Missing rows, changed payloads and invalid/future times
are explicit blockers. There is no 48-hour filter for this provenance check:
older rows still stored can be verified, but deleted rows cannot be reconstructed.
Successful checks include `observed_at` for each child and remove the timestamp
requirement from the report; the original package remains unchanged and non-executable.
Run check again using a new output filename such as `identity-split-times.json`.


### Apply and verify an explicitly reviewed package

`apply` is the only CLI mode that mutates the event store. It requires the exact
reviewed package checksum via `--approve`; do not generate approval by blindly
copying a checksum from an unreviewed file. The existing package stays unchanged.

Stop the web/collector (`Ctrl+C`), keep PostgreSQL reachable, and use:

```powershell
node --env-file=.env.local --import tsx tools/identity-split-package.ts check identity-split-package.json identity-before-apply.json
if ($LASTEXITCODE -ne 0) { throw "Preflight failed; do not apply" }
# Replace REVIEWED_CHECKSUM with the literal checksum from the reviewed report.
node --env-file=.env.local --import tsx tools/identity-split-package.ts apply identity-split-package.json identity-apply-receipt.json --approve REVIEWED_CHECKSUM
if ($LASTEXITCODE -ne 0) { throw "Apply failed; keep collector stopped and inspect" }
node --env-file=.env.local --import tsx tools/identity-split-package.ts verify identity-split-package.json identity-after-apply.json
if ($LASTEXITCODE -ne 0) { throw "Verification failed; keep collector stopped" }
npm run dev
```

All splits and receipts commit together. Metadata is locked; collector and signal
tables are held against concurrent writes while the source times, payloads, parent
revisions and identity assignments are checked again. No excluded group is applied.
Any failure before commit rolls back the entire package. This does not delete old
parents, evidence or revisions. New UUIDs are allocated only inside application.

A deterministic operation ID and database receipt make retries idempotent. If the
connection is lost after commit, repeat the same package and literal approval with
an unused output filename; it returns the stored receipt without writing again.
Output is reserved before mutation. A disk write failure after commit does not undo
the database transaction; its receipt remains recoverable by the same retry.

`verify` is read-only and checks the durable receipt, final cursor, parent replacement
revisions, prior history presence, child content/observation times and exact identity
assignments. Run it before restarting collection: subsequent collection may change
current payloads or advance the cursor and will be reported. `check` and `verify`
exit nonzero when their checks fail. Full rollback/retry and changed-precondition
scenarios are covered by the PostgreSQL integration suite.


### Event freshness in the feed and diagnostics

The feed and EVENT INGEST diagnostics share the three-minute freshness threshold.
Diagnostics update their clock every 15 seconds even when no new feed arrives;
returning to the tab also updates it. Cached or stale results label provider states
as `LAST: ...` and use an amber indicator rather than presenting old healthy states
as current availability. Refresh failures preserve the last feed and appear in both
views; a successful refresh clears the failure. Last-success timestamps include the
full UTC date as well as time. This is freshness of the feed, not a per-source heartbeat
or proof that a collector process is running.

### Camera overview, playback and diagnostics

Map camera previews show snapshots only; a source without a published still stays
as a clickable marker. The overview uses the provider URL and browser HTTP cache,
without a new persistent image cache or periodic image downloads. Opening a camera
starts a separate viewing panel: the selected camera plus up to three nearest
published video feeds within 2 km. Other map cameras do not start streaming.

Media loads directly in the browser. No video recording, server video cache or
new media relay is introduced. Existing image proxies remain unchanged. Closing
or switching the panel releases media elements/HLS decoders; hiding the browser
tab unmounts media sessions. Video controls allow manual playback when autoplay
is refused. TfL now reads `videoUrl` as an MP4 clip and retains `imageUrl` for the
map. Clips reload every five minutes and are labelled CLIP, not LIVE; snapshots
in the active panel refresh every 30 seconds. These are request intervals, not
claims about provider capture frequency. Only verified TfL URLs receive a cache
buster; other providers retain their original URLs and HTTP cache semantics.

A top-right overlay distinguishes client playback, image load, buffering and
media errors from the last SERVER HEAD result. An iframe loading is not proof
that its embedded player is playing. HTTP 200 does not prove a current picture;
media errors are not fabricated HTTP statuses. Sources that cannot play directly
may still be opened using their source link.

`GET /api/cctv/diagnostics?id=...` accepts up to eight catalog camera IDs, never
user-supplied target URLs. Camera catalog responses register HTTPS targets for
one hour. Demand-driven checks are shared within a server process, at most two
concurrent probes and one start per provider per five seconds, with a five-minute
successful-result TTL, exponential failure backoff and provider-wide Retry-After
for 429/503. HEAD-only probes do not download video bodies; unsupported HEAD is
explicitly inconclusive. Existing SSRF validation checks public addresses and
redirects. Client panels poll metadata every 30 seconds while visible; no probes
run without demand. Server metadata never gates playback.

This diagnostic cache/scheduler is process-local, bounded to 60,000 catalog
entries, and is lost on restart. A cold process or a different replica reports
UNKNOWN until its catalog is loaded. Multi-replica deployments need a shared
scheduler before treating the provider limits as deployment-wide guarantees.

Camera browser regression checks: `npm run test:camera-browser` (installed Google
Chrome required). CI uses a local synthetic MP4 fixture and mocked diagnostics,
covering snapshot-only overview, four-player selection, clip refresh, errors and
visibility/close cleanup. These tests do not certify live provider availability.

Camera windows are anchored to the dashboard's usable map workspace, including
expanded view and changes to the Events sidebar. Each image has one compact status
badge; hover its badge for the server HEAD result and timestamp. Failed snapshots
hide the browser's broken-image text. Map thumbnails no longer add scanline,
vignette or corner overlays. Nearby autoplay includes direct MP4/HLS/MJPEG feeds;
provider iframe pages require selecting that camera and are not opened as automatic
neighbors. Initial diagnostic requests are briefly deferred so rapid tile removal
and development StrictMode do not immediately start and abort redundant requests.
While cameras and Events share a narrow desktop view, the drawer backdrop is
suppressed so it cannot dim the video or intercept camera controls; closing the
camera restores normal drawer behavior. Browser regression tests exercise the
real DashboardShell with its Events panel.

In the camera viewer, use the name button below a neighboring player to make
that camera the main view. The nearby list is recalculated within 2 km of the
new selection (up to three neighbors). This preserves expanded mode and does
not move the map; the Locate button remains available for recentering. Native
video controls continue to control their own player.


### Browser event checkpoint recovery

The browser rejects cached events with missing or invalid replay sequence numbers,
observation timestamps, lifecycle metadata or duplicate identities and requests a
fresh checkpoint. A failed delta page or cancellation while reading a response
keeps the previous events and cursor together; partial updates are not saved.
After connectivity returns, synchronization resumes from that checkpoint (or
bootstraps when the server requests a cursor reset). Browser regression coverage
uses simulated outages and corrupted local storage; it does not verify live
source availability.


### Database connection recovery

The web event API and collector handle PostgreSQL pool errors from idle
connections without terminating their processes. The driver discards the broken
connection and the next operation attempts to reconnect. Logs identify the web
or collector process without dumping connection credentials. Errors in active
queries still propagate through the existing API error responses and collector
retry/backoff; failed writes are not reported as successful. This does not replay
an interrupted transaction automatically.

PostgreSQL CI terminates one test-owned idle connection, then checks reconnect,
lease acquisition, event commit/readback and propagation of an active SQL error.
No database migration is required.


### Debug export: event freshness

DEBUG → EXPORT retains the request log and adds `reportVersion: 2` with an
`eventIngest` health summary: read mode, client checkpoint save time, feed generation
time, cache/error state, freshness at export time, event counts and source health.
In durable mode, feed generation time represents the collector's last successful
collection; checkpoint time only indicates client synchronization. A successful
HTTP request alone does not establish fresh source data. Missing health is `null`.
The freshness threshold remains three minutes, shared with the feed UI. The new
summary includes no event bodies, evidence lists or replay cursors and makes no
additional network requests. Existing request-log fields remain unchanged.


### Source failures and GDELT discovery pacing

GDELT discovery runs its four existing queries sequentially with at least five
seconds between request starts and a ten-second timeout per request. Concurrent
calls share one in-flight batch within the process. On failure, the batch stops;
completed queries remain a partial result, while an entirely failed batch stays
unavailable. It does not replay old articles as fresh observations.

Retries happen on later collection cycles, with backoff from 90 seconds to a
15-minute cap. HTTP 429/503 Retry-After (seconds or HTTP date) can extend that
pause. Calls during the pause perform no network request. After a failure, the
next cycle starts with the following topic to prevent starvation; a fully
successful batch resets backoff. State is process-local and resets on restart;
separate processes are not coordinated by this limiter.

Core and supplemental source health now retain structured failure kinds:
`timeout`, `http`, `network`, `invalid_response`, `cancelled` or `unknown`.
DEBUG exports include the safe kind, HTTP status when known and GDELT retry time,
without raw provider exception text. Existing health states remain healthy,
partial or error; a paused failed source is never labeled healthy.

Windows dev and production smoke tests also request camera diagnostics with an
unknown ID and require a JSON UNKNOWN response, alongside health and event sync.
These deterministic tests do not establish live GDELT availability or diagnose
older failures whose detailed causes were not recorded.

### Reviewed camera playback variants

The camera viewer prefers a loaded video variant of a selected snapshot only
when an explicit reviewed alias links them. The initial alias links Windy image
`1357151208` to DIGI camera `3307` (Predeal), whose HLS path is published in
[DIGI's camera catalogue](https://www.digi.ro/servicii/online/web-cams).
The matching road and roof view was reviewed from the reported September 26
screenshot. Predeal Centru is a separate camera. City names and nearby coordinates
are never sufficient to merge cameras.

When both variants are loaded, the main player uses the video record, including
its source and diagnostic ID, and retains the snapshot as a fallback. The same
camera is excluded from nearby tiles. Without the loaded video record, the
snapshot stays selected; no stream URL is guessed or fetched by this mapping.
Overview behavior is unchanged. Playback errors and startup timeouts expose the
snapshot fallback with unverified freshness and an explicit media status. Media
continues to load directly in the browser, without server video storage.

Client-cancelled requests remain visible as amber `ABORT` rows in debug history
and exports, but do not increment the error counter. Server-side upstream aborts
remain failures because they can represent deadlines. Camera page resolution is
deferred briefly and cancelled on unmount to avoid StrictMode probe requests.

### Batched collector observations

The collector writes incoming signals in SQL batches of at most 100 input rows
inside one transaction. Exact signal identities and last-write-wins behavior for
duplicate observations are preserved within and across batches. Absent sources
retain their previous observation timestamps; replaying cached data does not
refresh them. A failed batch rolls back all signal writes in that cycle.

The transaction retains the metadata lock and validates/renews database-time
collector ownership before writes and before commit. Lock acquisition is bounded
by a ten-second lock timeout. This reduces database round trips without changing
fusion, durable event history, or the existing 48-hour transient signal policy.
A maintained test checks that 3,000 inputs require 30 upsert statements; this is a
query-count guarantee, not a measured end-to-end speedup. No migration is needed.
