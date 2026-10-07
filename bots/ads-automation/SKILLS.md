# Automation operating rules

This file governs implementation, investigation and recovery of the Telegram Ads pilot. `STATE.md` records the current checkpoint.

## Execution loop

1. Inspect actual persisted state and identify the failing boundary.
2. Implement the necessary scoped fix; ask the owner about ambiguous product decisions or unapproved scope extensions.
3. Verify with meaningful automated checks and the real no-spend integration where possible.
4. Review failure paths, record evidence and correct defects before reporting completion.

## Financial authority

- Only persisted managed experiment IDs may be mutated. Never infer ownership from the provider's campaign list.
- Allocation and spend authority are separate. Reserve authority transactionally before a financial request.
- Retry with persistent idempotency; ambiguous API outcomes require reconciliation, never blind funding replay.
- Calendar rollover does not grant a fresh test share. Brain outage must not authorize additional spend.
- Keep both live/cost gates disabled until controlled account tests and required owner approvals are recorded.
- Admin calibration approvals remain required; repeated approvals must not repeat spending.

## Integration and evidence

- Local Codex/Claude process consumes leased schema-validated jobs; it has no direct financial authority.
- Server owns the admin bot poller, queue, monitoring and durable history.
- Preserve candidates, decisions, tests and source evidence, including rejected or deleted campaigns.
- Winner eligibility requires the last two complete 0.05 TON tests, finite nonnegative metrics, positive integral views/actions and at least five total actions under the target CPA. Partial or overspent rounds cannot authorize graduation, including after owner approval. Retain every learned-claim revision in audit; separate creative/experiment claims and mark obsolete generated validation as needs_review instead of erasing evidence or treating it as a negative category insight.
- Separate Telegram CPA, new/returning product users, gross revenue and unknown refunds. Do not invent a currency conversion or net return.
- Validate research peers and mark unavailable metrics as unknown. Never infer country from language alone.
- Initial competitor baseline requires independently observed public peer identity/counts: at least 5,000 channel subscribers or 10,000 bot monthly users, fresh evidence within 24 hours, direct relevance and explicit market review. Channels also need recent sampled public content. Unknown-size, inactive, unrelated and lateral peers stay in reserve; a large count never proves profitability or Ads availability. Do not compare MAU with subscriber counts.
- Treat directory audience/language/eligibility as provider claims, not Telegram facts. Exclude groups and synthetic/demo responses. Retain source URLs, observation times and graph parents; preserve previous evidence on rediscovery. Review responses must match the exact current peer observation.
- Public source work runs separately from protective Ads polling. Persist provider/domain cooldowns and interrupted-run leases; fence completion by lease token. A provider outage is not a valid empty search result, and recovery must not replay financial actions.
- The owner selected a separate discovery Telegram user account. Do not authenticate the personal account. Native search/recommendation adapters are not production-verified until the dedicated session is connected. Full-text public-post search must respect Telegram's free-slot and manual-initiation contract; never authorize paid Stars.
- Image input must match the current request/revision, pass visual QA and preserve essential text during resizing.

## Recovery and security

- Inspect active deployment before running package installation; never compile the same package concurrently with CI.
- Restart only the affected service. Verify native dependency loading before restarting it.
- Log structured event IDs, outcomes and bounded errors; redact tokens, environment values and deployment command arguments.
- Secrets belong in ignored local/server configuration or approved secret storage, never Git, Sheets or reports.
- Preserve the original dirty checkout; use the attached managed worktree and Conventional Commits. PR titles/descriptions are English.

## Authorized Gemini browser production

- The owner authorized browser image generation, download and reply delivery on 2026-10-05. Use only `alirezaoliyaforspotify@gmail.com`; verify the visible active-account identity and Pro before sending prompts. Never use another account or purchase an upgrade.
- Consume the latest persisted banner request/revision and its exact prompt. Select image mode and 16:9. Download the original, preserve provenance, and reply as a document to that request in `@AliAdsOpsControlBot`.
- Wait for real server acceptance and subscription-backed vision QA. A sent or downloaded file alone is not completion; rejected images follow the existing correction queue. No paid image API, separate text overlay or Ads funding is authorized by image-generation permission.
- Browser production requires the desktop/browser session; server polling and cost guards remain independent. Do not claim an unattended server Gemini integration from a successful browser run.
