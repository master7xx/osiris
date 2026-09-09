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

## Research queue

Prioritize other state/provincial/national traffic authorities and municipal open-data portals over third-party webcam directories. For each candidate, verify API stability, coordinates, feed format, rate limits, licensing/attribution requirements, and whether direct embedding is technically and contractually appropriate before integration.
