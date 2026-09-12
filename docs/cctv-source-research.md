# CCTV source research notes

Research notes for extending the default CCTV catalogue.

## Geographic implementation freeze

New CCTV source work is frozen outside the country tiers below. Existing cameras and existing global aggregators continue to operate worldwide; the freeze applies to **new integrations, new aggregation work and coverage-improvement work**. A camera from a frozen country may still appear naturally through OpenCCTV, Windy or another already-integrated broad catalogue.

Implementation order:

1. **Tier 1 — highest priority:** Belarus, Poland, Russia.
2. **Tier 2:** Ukraine, Latvia, Lithuania.
3. **Tier 3:** Armenia, Azerbaijan, Georgia, Tajikistan, Turkmenistan.
4. **All other countries:** frozen / lowest backlog until this policy changes.

The Coverage Matrix follows the same rule. It continues to report worldwide camera statistics, but countries outside these tiers no longer contribute to CCTV gap scores or implementation-priority signals.

## Source priority inside the target countries

Prefer integrations that materially improve situational awareness rather than raw camera count. The target order is:

1. broad public/global aggregators that materially improve one or more priority countries;
2. national or multi-country **general-purpose** camera catalogues;
3. high-information-value networks and individual cameras: borders, ports/harbours, airports, major public squares and urban viewpoints, coastlines/weather, industrial or strategic transport nodes, volcanoes and other observation systems;
4. large regional systems that fill a clear geographic hole in a priority country;
5. traffic-only camera feeds only when they arrive through a broad aggregator or a particular road camera has unusually high situational/citation value.

Existing road-camera adapters remain supported, but new secondary traffic-camera networks should normally be rejected even inside the target countries. A specialized road source needs a clear information-value argument beyond routine traffic monitoring.

## Admission criteria

A source should be added only when it is public, stable enough for unattended use, machine-readable, exposes coordinates, does not require scraping a consumer webpage, and has terms/technical behavior compatible with displaying or linking the camera feed. Sources requiring an API key or registration should normally stay optional rather than default.

A specialized source should also pass an information-value test. A nationwide road feed that mostly duplicates aggregator coverage is low priority; an official border, port, airport, severe-weather or otherwise highly cited camera can be worthwhile even when the network is geographically smaller.

## Integrated macro coverage

### OpenCCTV

- Public worldwide directory used as a broad discovery layer underneath official and curated adapters.
- The shared marker index is fetched once and then narrowed locally; full camera records are requested in bounded batches.
- Existing East Asia, Southeast Asia, Europe, Russia/Northern Eurasia, Africa, Latin America and Oceania/Pacific coverage remains active.
- Spatial grid sampling is preferred to taking the first N/index-stride alone so dense operators and megacities do not crowd sparse areas out of the capped result.
- Future OpenCCTV aggregation work should target Tier 1 first, then Tier 2 and Tier 3. Do not spend implementation effort improving frozen countries merely because the global index contains them.

### Windy Webcams API v3 — optional

- Integrated as an optional environment-keyed macro provider via `WINDY_WEBCAMS_API_KEY`.
- Existing worldwide macro coverage remains active; Windy is enrichment, never a prerequisite for a region.
- Only genuine `player.live` embeds are admitted to OSIRIS. Windy's short-lived V3 image-token URLs are deliberately not persisted in the 30-minute CCTV index cache.
- Every mapped camera keeps the Windy detail URL and the source label `Webcams provided by Windy.com`; the embedded Windy player remains the provider-supported display surface.
- If the key is absent, all Windy functions return immediately with an empty list and the existing keyless CCTV catalogue is unchanged.
- New Windy cells, ranking work or region-specific enrichment should only be implemented when it benefits the active country tiers.

### Curated live catalogues

- Existing `world-live`, `asia-live` and country adapters remain available for backward compatibility and background coverage.
- No new curated-country expansion is planned outside the active country tiers.
- Existing official road-camera adapters remain supported but are not templates for future source expansion.

## Strategic official camera networks

### USGS Volcano Hazards Program / Ashcam

- Already integrated official public machine-readable webcam API.
- OSIRIS admits only rows explicitly associated with a volcano and rejects road/highway/traffic-labelled rows.
- It remains supported as an existing source, but further USGS/US camera expansion is frozen under the current geographic policy.

## Previously researched regions now frozen

Japan/MLIT xROAD, additional US state DOT feeds, Africa, Latin America, Oceania and other non-priority regions are not active CCTV research targets. Keep existing integrations operational, but do not spend implementation time adding or expanding sources there unless the geographic policy is changed.

## Priority research queue

### Tier 1 — Belarus, Poland, Russia

Research these countries in parallel, with preference for broad catalogues and strategically useful non-road cameras. Strong candidates include major-city/public-space cameras, border approaches and crossings where public feeds are legitimately available, airports, ports/river terminals, weather/coastal observation, and high-citation individual live cameras. For Russia, GEOCAM/Cam-World-style catalogues remain interesting only if a stable machine-readable API/embedding contract can be verified; do not scrape consumer pages.

### Tier 2 — Ukraine, Latvia, Lithuania

Start after Tier 1 coverage/source diversity is materially improved. Use the same source-quality and non-road criteria. Existing aggregator cameras are welcome; avoid building dedicated routine traffic-camera adapters unless a source has unusual situational value.

### Tier 3 — Armenia, Azerbaijan, Georgia, Tajikistan, Turkmenistan

Treat as the next expansion belt after Tier 2. Prefer cross-country or national general-purpose indexes over one-off municipal road systems.

## Research checklist

For every candidate, verify API stability, coordinates, feed format, rate limits, licensing/attribution requirements, whether direct embedding is technically and contractually appropriate, and the real geographic or situational gain over OpenCCTV plus Windy. Slow successful responses are diagnostic only and are not a provider-health failure.
