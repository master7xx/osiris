# CCTV source research notes

Camera discovery combines public aggregator catalogues, optional provider APIs,
and existing official and curated adapters. Coverage and availability vary with
provider data, network access and configuration.

OpenCCTV shares a marker index between geographic queries, fetches details in
bounded batches and uses spatial sampling. Windy is optional and requires
`WINDY_WEBCAMS_API_KEY`; its supported live-player embeds retain attribution.
Existing adapters and their configuration are described in the README.

Before adding a source, verify its published access terms, machine-readable data,
coordinates, feed formats, rate limits and attribution requirements. An indexed
camera or successful HTTP response does not establish that a current image or
video is available. Slow successful responses are diagnostic information rather
than a provider-health failure.

Coverage diagnostics use configured watchlists and gap calculations; they do not
represent a complete inventory of cameras or independently verify live feeds.
