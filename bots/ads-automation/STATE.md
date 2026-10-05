# Automation checkpoint

Updated: 2026-10-05. This file records verified progress and outstanding work; credentials must never appear here.

## Approved pilot

- English globally, no country restriction; destination `@TAROOT_RU_BOT`.
- CPA target: 0.05 TON per action. Pilot spend authority: 3 TON.
- Allocation limit: 20 TON, at most 20 independent campaigns, initially 1 TON each.
- Each test round may consume 0.05 TON in total across calendar days.
- Calibration remains enabled. Existing campaigns are outside automation authority.
- Image generation remains the approved manual Gemini/reply step.

## Verified implementation

- PRs #473, #477 and #481 merged: server workflow, separate allocation/spend reservations, strict research output schema.
- Server uses `/home/ubuntu/voice2text`, SSH alias `vps`, PM2 process `ads-automation`.
- Native SQLite installation completed after installing build tools; process observed online. Latest restart stability and end-to-end jobs still require verification.
- Project 1 (`tarot-en-global-2026`) registered in calibration with 20 research seeds. No live experiments created.
- Product scope `tarot-intl@en` resolves to the existing destination. Per-version attribution bridge is implemented; real attribution round trip remains to be checked.
- Admin bot: `@AliAdsOpsControlBot`. Server owns polling; no competing local poller is authorized.
- Latest local suite before this checkpoint: 24 tests passed. A fresh run is in progress.

## Remaining acceptance work

1. Confirm current server SHA, PM2 stability and bot status after deployment.
2. Execute queued research through local Codex, then strategy/copy/banner jobs. Install persistent local worker only after that round trip passes.
3. Verify product link creation and late-conversion reports without Ads spend.
4. Configure automatic Sheets credentials and preserve existing manual discovery rows before enabling mirror writes.
5. Exercise admin reply/image QA and correction flow with real image input.
6. Obtain authorized Ads API access and conduct explicitly approved controlled account validation.

## Gates and limitations

- `ADS_LIVE_ENABLED=0` and `ADS_COST_GATE_VERIFIED=0`. No Ads credentials configured. No advertising has been created, funded or altered by this work.
- Exact provider-side 0.05 TON enforcement, actual daily reset, precision and delayed-statistics behavior are not yet account-verified.
- Net product revenue cannot be claimed until per-code refunds are available.
- Public-channel evidence is a hypothesis, not proof of Ads inventory availability or audience country.
- Google Sheets exists but automatic server mirroring is not configured.

## Current working copy

- Managed worktree: `/Users/alireza/.codex/worktrees/telegram-ads-automation/Telegram_bots`.
- Branch: `codex/ads-sqlite-deploy`. The speculative SQLite downgrade was reverted because mtcute still requires SQLite 12; no dependency downgrade is pending.
- User's original dirty checkout must remain untouched.
