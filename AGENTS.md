# Repository guidance

## Keep documentation current

The user requires README.md to stay aligned with the implemented application.
For changes to user-visible behavior, architecture, APIs, source integrations,
configuration, setup or deployment, update README.md in the same PR. Update
relevant linked documentation when its instructions are affected.

Describe implemented behavior separately from planned work. Verify commands,
paths, environment variables and API semantics against the current code; do not
claim live provider availability, deployment success or test results without
verification. Avoid fixed coverage/performance numbers without maintained evidence.

For internal changes with no documentation impact, check the README and record
that no update is needed in the PR description rather than making cosmetic edits.
