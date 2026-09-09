# CCTV source research notes

Low-priority candidate list for extending the default CCTV catalogue.

## Admission criteria

A source should be added to the default catalogue only when it is public, stable enough for unattended use, machine-readable, exposes coordinates, does not require scraping a consumer webpage, and has terms/technical behavior compatible with displaying or linking the camera feed. Sources requiring an API key or registration should normally stay optional rather than default.

## Integrated

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

## Not default candidates

- **511NY:** the official camera API requires a developer key and is throttled. It may be useful later as an optional, environment-keyed adapter, but it does not meet the no-key default-source policy.
- **511PA:** public camera viewing exists, but no stable no-key machine-readable camera API has been verified yet. The public site also documents simultaneous-stream limits, so it should not be integrated by scraping or by blindly opening many video streams.

## Research queue

Prioritize other state/provincial/national traffic authorities and municipal open-data portals over third-party webcam directories. For each candidate, verify API stability, coordinates, feed format, rate limits, licensing/attribution requirements, and whether direct embedding is technically and contractually appropriate before integration.
