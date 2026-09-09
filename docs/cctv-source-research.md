# CCTV source research notes

Low-priority research notes for extending the default CCTV catalogue.

## Current priority

Prefer integrations that materially increase **world-scale coverage** over one-city or one-state collections. The target order is:

1. global/public aggregators with stable machine-readable APIs;
2. national or multi-country traffic-camera feeds;
3. large regional systems that fill a clear geographic hole;
4. local collections only when they add unique strategic coverage.

Current focus areas are Europe, Russia/Northern Eurasia, East Asia/Japan and Southeast Asia.

## Admission criteria

A source should be added to the default catalogue only when it is public, stable enough for unattended use, machine-readable, exposes coordinates, does not require scraping a consumer webpage, and has terms/technical behavior compatible with displaying or linking the camera feed. Sources requiring an API key or registration should normally stay optional rather than default.

## Integrated macro coverage

### OpenCCTV

- Public worldwide directory used as a broad discovery layer underneath official national adapters.
- The shared marker index is fetched once and then narrowed locally; full camera records are requested in bounded batches.
- East Asia already covers Japan, the Koreas, Taiwan and China; Southeast Asia covers Indochina, Indonesia and the Philippines.
- The West/Central Asia loader now also includes the northern Eurasian belt, substantially improving Russia/Siberia coverage without another global index download.
- Europe combines the curated live-webcam catalogue with a spatially sampled OpenCCTV layer.
- Spatial grid sampling is preferred to taking the first N/index-stride alone so dense operators and megacities do not crowd sparse countries out of the capped result.

### Curated live catalogues

- `world-live` supplies Latin America, Africa and Europe.
- `asia-live` supplements national traffic feeds across Asia.
- Official country adapters remain the preferred source where available; aggregator entries are the broad-coverage fallback.

## Integrated official regional sources

### Maryland MDOT CHART / MD iMAP

- Official Maryland transportation source.
- Public ArcGIS camera index; no API key required by the adapter.
- Provides camera identity/location plus public viewer/embed fields.
- Integrated as its own cached `maryland` region so a slow upstream cannot delay the existing curated `us-east` cameras.
- The adapter only promotes an explicit image URL to `feed_url`; viewer pages remain external/iframe targets rather than being mislabeled as JPEG snapshots.

### Iowa DOT

- Official Iowa DOT 511/open-data source for data integrators.
- Iowa DOT states that its ESRI feature services do not require credentials and directs integrators to the traffic-camera feature service for current image/video URLs.
- The ArcGIS layer exposes stable IDs, descriptions, image/video URLs and explicit latitude/longitude fields.
- Integrated as its own cached `iowa` region with Iowa bounds, rather than coupling it to the broad `us-central` source.
- `ImageURL` is used as the snapshot feed. `VideoURL` is promoted to inline HLS only when it explicitly names an `.m3u8` playlist; unknown video formats remain external links.

## Optional / not-default candidates

- **Windy Webcams API:** excellent worldwide coverage and proper bbox/country APIs, but requires an API key; the free tier also uses short-lived image URLs and requires Windy attribution/linking. Strong candidate for an optional environment-keyed provider rather than a no-key default.
- **GEOCAM / Cam-World:** useful discovery catalogues, especially for Russia, but no verified public machine-readable API/embedding contract yet. Do not integrate them by scraping consumer pages.
- **511NY:** the official camera API requires a developer key and is throttled. It may be useful later as an optional adapter, but it does not meet the no-key default-source policy.
- **511PA:** public camera viewing exists, but no stable no-key machine-readable camera API has been verified yet.

## Research queue

Prioritize sources that add many countries or an entire national network. For each candidate, verify API stability, coordinates, feed format, rate limits, licensing/attribution requirements, whether direct embedding is technically and contractually appropriate, and the real geographic gain over OpenCCTV plus the existing official adapters.
