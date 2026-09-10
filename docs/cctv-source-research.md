# CCTV source research notes

Research notes for extending the default CCTV catalogue.

## Current priority

Prefer integrations that materially increase **world-scale situational awareness** over one-city, one-state, or traffic-only collections. The target order is:

1. global/public webcam aggregators with stable machine-readable APIs;
2. national or multi-country **general-purpose** camera catalogues;
3. high-information-value camera networks: volcanoes, ports/harbours, airports, borders, coastlines/weather, public squares and major urban viewpoints;
4. large regional systems that fill a clear geographic hole;
5. traffic-only camera feeds only when they are already part of a broad aggregator or a particular camera has unusually high situational value.

Existing road-camera adapters remain supported, but adding more road-specific providers is not a research priority.

Current focus areas are Japan/East Asia, Europe, Russia/Northern Eurasia, Africa and Latin America, with source diversity preferred over adding density from a single provider.

## Admission criteria

A source should be added to the default catalogue only when it is public, stable enough for unattended use, machine-readable, exposes coordinates, does not require scraping a consumer webpage, and has terms/technical behavior compatible with displaying or linking the camera feed. Sources requiring an API key or registration should normally stay optional rather than default.

A specialized source should also pass an information-value test. A nationwide road feed that mostly duplicates aggregator coverage is low priority; an official volcano, port, border, airport, severe-weather or globally cited live camera can be worthwhile even when the network is geographically smaller.

## Integrated macro coverage

### OpenCCTV

- Public worldwide directory used as a broad discovery layer underneath official and curated adapters.
- The shared marker index is fetched once and then narrowed locally; full camera records are requested in bounded batches.
- East Asia covers Japan, the Koreas, Taiwan and China; Southeast Asia covers Indochina, Indonesia and the Philippines.
- The West/Central Asia loader also includes the northern Eurasian belt, substantially improving Russia/Siberia coverage without another global index download.
- Europe, Africa, Latin America and Oceania/Pacific use spatially sampled macro layers for geographic breadth.
- Spatial grid sampling is preferred to taking the first N/index-stride alone so dense operators and megacities do not crowd sparse countries out of the capped result.

### Windy Webcams API v3 — optional

- Integrated as an optional environment-keyed macro provider via `WINDY_WEBCAMS_API_KEY`.
- Uses multiple broad geographic cells for Europe, Russia/Northern Eurasia, East Asia/Japan, Africa, Latin America and Oceania/Pacific rather than taking the first 50 cameras from a whole continent.
- Only genuine `player.live` embeds are admitted to OSIRIS. Windy's short-lived V3 image-token URLs are deliberately not persisted in the 30-minute CCTV index cache.
- Every mapped camera keeps the Windy detail URL and the source label `Webcams provided by Windy.com`; the embedded Windy player remains the provider-supported display surface.
- If the key is absent, all Windy functions return immediately with an empty list and the existing keyless CCTV catalogue is unchanged.
- Windy is enrichment, never a prerequisite for a region.

### Curated live catalogues

- `world-live` supplies Latin America, Africa and Europe and combines curated, OpenCCTV and optional Windy coverage.
- `asia-live` supplements Asia with general live streams and optional Windy East Asia/Japan live players.
- Existing official country adapters remain available, but new traffic-only adapters are not a priority unless they add unique situational value.

## Strategic official camera networks

### USGS Volcano Hazards Program / Ashcam

- Official public machine-readable webcam API used by USGS volcano applications.
- The catalogue exposes coordinates, volcano metadata and current snapshot URLs.
- OSIRIS admits only rows explicitly associated with a volcano (`vName`/`vnum`) and rejects road/highway/traffic-labelled rows so this remains a strategic observation layer rather than another traffic feed.
- The source is keyless and cached. It is optional enrichment for global snapshots plus Cascades/Alaska-Aleutians viewports and existing western-US regions.
- USGS explicitly notes that the API is provided for its applications without a guarantee of permanent support, so failure is fail-soft and never blocks the ordinary CCTV response.

## Japan / MLIT xROAD review

- Japan already has a curated `japan.ts` layer with public MLIT river cameras plus live public streams, and is also covered by OpenCCTV East Asia and optional Windy.
- MLIT's Road Data Platform / xROAD is publicly available and documents multiple APIs, including DRM-PF and nationwide traffic-volume data.
- The currently published xROAD API material reviewed for this integration does **not** expose a verified nationwide public CCTV image/video catalogue suitable as a drop-in OSIRIS camera source.
- MLIT documents CCTV as one input to AI traffic counters, which is not equivalent to publishing the underlying CCTV feeds through the traffic-volume API.
- Because traffic-only expansion is now low priority anyway, xROAD should only be revisited if it exposes cameras with broader situational value or a genuinely general-purpose nationwide camera catalogue.

## Existing official road-camera adapters

Maryland MDOT CHART, Iowa DOT, TfL, WSDOT, Caltrans and other previously integrated road-camera providers remain supported for backward compatibility and useful background coverage. They are not templates for future source expansion. New work should prefer broad aggregators or strategic non-road observation networks.

## Optional / not-default candidates

- **GEOCAM / Cam-World:** potentially useful discovery catalogues, especially for Russia, but no verified public machine-readable API/embedding contract yet. Do not integrate them by scraping consumer pages.
- **EarthCam / Skyline-style commercial catalogues:** potentially high-value urban views, but only integrate where a stable machine-readable/embedding contract is verified; do not scrape consumer pages.
- **511-family traffic APIs:** no longer a research priority unless a specific feed provides unique strategic coverage not already present through aggregators.

## Research queue

Prioritize sources that add many countries, source diversity, or unusually high information value. Current targets are broad non-road catalogues and official camera networks for Japan/East Asia, Europe, Russia/CIS, Africa and Latin America; ports/harbours, volcano observatories, airports, borders and severe-weather/coastal systems are preferred over additional traffic networks. For every candidate, verify API stability, coordinates, feed format, rate limits, licensing/attribution requirements, whether direct embedding is technically and contractually appropriate, and the real geographic or situational gain over OpenCCTV plus Windy.
