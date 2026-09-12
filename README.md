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
tombstones, independently scheduled sources, replay-based UI updates, remaining
report adapters (NWS, NOAA and cyber advisories), and further consumer convergence.
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

Use PostgreSQL 17, the integration CI target. Create a database, then in PowerShell:

```powershell
$env:EVENT_DATABASE_URL = "postgres://USER:PASSWORD@localhost:5432/osiris_events"
npm run events:migrate
npm run events:collect
```

In a second terminal, in the repository:

```powershell
$env:EVENT_DATABASE_URL = "postgres://USER:PASSWORD@localhost:5432/osiris_events"
$env:EVENT_READ_MODE = "durable"
npm run dev
```

Wait for the collector's first successful commit. Until then, durable reads report
unavailability. Ctrl+C stops the collector; stored events survive its restart.
Migrations are transactional and checksum-checked. No timer runs inside Next.js.

- `/api/events/stored` returns all retained current records and a consistent
  opaque replay cursor. It also exposes the last collector success/error.
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
in collector status. Sources still use existing adapter timeouts; independent
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
