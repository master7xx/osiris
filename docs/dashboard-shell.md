# Dashboard shell: implementation stage A

Implements the first part of the reference interface plan in PR #31, on top of
master after PR #30. This is a layout change, not a new ingestion pipeline.

## Changed components

- `DashboardShell.tsx` owns header, navigation/news visibility and panel layout.
  Its slots keep the existing page responsible for data, layers and tools.
- `dashboard-shell.css` scopes the new navy/cyan chrome to the shell. Existing
  map palette and Style Studio settings are not overwritten.
- `LayerPanel.tsx` supports a docked expanded view using existing layer definitions
  and a compact icon rail. Credential gates, sublayer controls and theme actions
  remain available. Expanded navigation scrolls independently.
- `page.tsx` supplies the existing layer controls, IntelFeed, SearchBar, UTC clock
  and backend status. The original phone layout and desktop tool strip remain.
- `OsirisMap.tsx` observes container size changes with ResizeObserver and cleans
  up the observer on map removal.

## Geometry and behavior

| Item | Behavior |
| --- | --- |
| Header | 56 px, UTC and API connection status; no all-sources-health claim |
| Navigation | 208 px expanded, 56 px compact; defaults expanded at >=1440 px |
| News | 352 px on wide desktop, 320 px below 1440 px; can be closed |
| Desktop map | Occupies the space between docks, below the header |
| Width <1024 px | Map remains beside the compact rail; expanded panels overlay it, one at a time |
| Phone detection | Existing page logic still selects the existing mobile UI |
| Layer visibility | Existing L shortcut hides/shows navigation; header can reopen it |
| Selection/settings | Layer state remains in the page; stored styles and URL layer keys are unchanged |
| Close actions | Focus returns to the header control; Escape in a side panel closes it |
| Motion | Shell descendants respect reduced-motion preferences |

The news panel remains `/api/news` with the existing SIGINT content. It does not
claim to be the unified World Events list. Opening/closing it mounts/unmounts the
existing poller, which retains its cleanup behavior. Backend `CONNECTED` describes
the application's connection check, not the health of all upstream providers.

## Validation and remaining gate

- TypeScript checking and ESLint for the new shell component are required.
- Existing LayerPanel has pre-existing lint errors for `any`; this change does not
  claim a clean repository-wide lint run.
- The local Next development runtime hits `uv_resident_set_memory` in this
  environment; the cloud browser also rejected the localhost preview address.
  No browser screenshot or interactive validation is claimed.
- Windows CI must pass before merge.
- Keep this PR a draft until browser checks cover desktop and narrow widths,
  visible map resizing, opening/closing docks, compact flyouts, scroll reachability,
  keyboard focus, L shortcut, existing tools and saved-style/URL restoration.
  Check 1920x1080, 1440x900, 1366x768, 1024x768 and phone layout, plus browser zoom.

## Next stage

Move the news list and world-event marker selection to one client-side snapshot
from `/api/events`, with category/severity/confidence filters and shared selected
ID. Then refine the event card, source-health states and DEBUG sizing. The existing
latest-state API limitations remain until durable storage is implemented.
