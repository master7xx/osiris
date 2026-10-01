# September 30 identity history investigation

Evidence: user-supplied checksummed snapshot sampled September 30, 2026.
The snapshot contains 15 requested events, 202 revisions and 38 stored identity
links. This is one fixed local database snapshot, not a live system audit.

## FIRMS

Event `51e0f859-a4e8-4dcd-8ae4-d93505f6239f` contains 170 revisions.
Both NASA FIRMS sensor identities used the provider homepage as their key.
The VIIRS and MODIS adapters generate distinct cell/day IDs but previously
omitted those IDs from evidence. Shared URLs caused fusion and durable lookup
to treat unrelated clusters as the same report. Revision 169 is near
(-20.4049, 126.5437), Australia; revision 170 near (9.6474, -63.5954), Venezuela.
The stored GDACS link identifies an Australian report, not the Venezuelan cluster.

Code corrections prevent future collection-key writes and normalize retained
adapter signals in memory. They do not repair the old UUID or its aliases.
Historical reconstruction is blocked: fused UUID revisions do not retain the
original FIRMS cell/day adapter IDs, and their descriptions/coordinates may
already represent composites. Do not infer original cluster identities from a
fused centroid or move the GDACS link without reviewing its report payload.

## News

All 35 requested news links occur in revision evidence; none has its original
signal in the retained signal store. Ten have at least one singleton stored
context; 25 have only composite contexts. This provides partial content review,
not full recovery of original articles.

Event `9f9a394f-87f6-4e0b-a37b-3b9fca6d18cf` demonstrably contains unrelated topics.
Two WarTranslated keys have singleton contexts: revisions 3/5 describe the
Ivankiv school strike; revisions 4/6 describe Putin's negotiation remarks.
The ASTRA key appears only in composite revisions 1/2. Its composite title
concerns Putin, but this alone is insufficient to assign every payload field.

Proposed review direction: separate the school report from negotiation reports.
Before an executable package, review original content (or a reliable saved
source copy), choose target grouping across the other stored UUIDs, construct
accurate child payloads, and verify revisions/epoch against a fresh snapshot.
Do not promote composite descriptions, locations or cross-language title
similarity to verified original evidence. Remaining Kyiv/Iran/St Petersburg
parents need the same content review; title changes alone do not prove a split.

## Boundary

No database mutations were performed. Existing snapshot replay remains the
strict hazard planner; the new history-context tool is explicitly non-executable.
