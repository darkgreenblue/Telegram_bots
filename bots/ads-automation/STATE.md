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
- Native SQLite installation completed after installing build tools. PR #483 merged as `8d717224d8932b3185f46edd6ce54e06fbc8b96e`; Deploy run 37320588476 executed Deploy to VPS successfully in about two minutes. Server HEAD matched the merge and ads process was online with restart counter 2.
- Project 1 (`tarot-en-global-2026`) registered in calibration with 20 research seeds. No live experiments created.
- Product scope `tarot-intl@en` resolves to the existing destination. Per-version attribution bridge is implemented; real attribution round trip remains to be checked.
- Admin bot: `@AliAdsOpsControlBot`. Server owns polling; no competing local poller is authorized.
- Latest local suite: 37 tests passed; all 22 selected repository CI checks passed.
- Research job 1 completed through the actual subscription-backed Codex/SSH round trip. The store now has 39 candidates and 20 strategy jobs.
- Local worker installed as `org.alireza.telegram-ads-brain` in `~/Library/LaunchAgents/`; observed running and leasing strategy job 2. Logs: `data/brain-logs/`. It processes brain jobs only, never polls the admin bot.
- PR #483 fixes deployment timeout/repeated native builds, research URL/target contracts, duplicate/stale banner replies and long-prompt truncation. Server deployment passed. The actual `/status` handler delivered to the owner through Telegram without starting another poller.
- Actual product `stats_all` bridge passed for `tarot-intl@en`: Stars unit, payment events supported, one existing attribution code. Creation/entry attribution still needs verification.
- User approved creating a dedicated Google service account in `tg-voice2text-bot`, editor of only the Ads sheet, with its key on the VPS. Existing Cloud SDK scope set was verified before renewal. Owner phone authentication completed. Dedicated account `telegram-ads-mirror@tg-voice2text-bot.iam.gserviceaccount.com` was created without project IAM roles; only the specified spreadsheet was shared as writer. Ignored key installed with mode 600 locally and on VPS; a real Sheets metadata read with that key passed.
- Existing manual Sheet rows were preserved as native duplicates: Archive Candidates 2026-10-05 (864660455), Archive Tests 2026-10-05 (491827409), Archive Insights 2026-10-05 (1808106150). Original three tabs remain first; sampled candidate values match their archived copy.
- Ads API page recovered and displays an existing masked token. Copy returned no token and the rendered input contains only the masked value. Owner was asked whether the old token is used elsewhere and may be replaced; no revocation or new token issuance has occurred. Official docs page still resets the browser connection. No financial write was attempted.

## Remaining acceptance work

1. Startup fix deployed in PR #484 (merge f101a9afcc948da2d788db4b7ee93bce2868e56e). Deploy run 37323911810 actually executed Deploy to VPS successfully at 14:22:48 UTC. Real server lease and cycle.completed records passed; PM2 restart counter 3. Continue checking stability, not just process online status.
2. Verify strategy/copy/banner stages from the installed local worker; the research round trip and persistent worker startup passed.
3. Real product link creation passed for experiment 1: two calls returned the same c_CODE, persisted on the draft experiment, and the real per-code stats bridge returned the Stars unit. No product-user entry or payment was fabricated. Real entry/refund attribution remains pending.
4. Real VPS Sheet write passed with 39 candidates and 10 draft tests. Independent connector reads confirmed the new values and preserved Brazil archive. Still verify the periodic server sync, not only the manually invoked sync.
5. Exercise admin reply/image QA and correction flow with real image input.
6. Obtain authorized Ads API access and conduct explicitly approved controlled account validation.

## Gates and limitations

- `ADS_LIVE_ENABLED=0` and `ADS_COST_GATE_VERIFIED=0`. No Ads credentials configured. No advertising has been created, funded or altered by this work.
- Exact provider-side 0.05 TON enforcement, actual daily reset, precision and delayed-statistics behavior are not yet account-verified.
- Net product revenue cannot be claimed until per-code refunds are available.
- Public-channel evidence is a hypothesis, not proof of Ads inventory availability or audience country.
- Google service account is configured on the server and real writes passed. Account has no project-wide IAM role. Periodic sync acceptance is pending the next server interval.

## Current working copy

- Managed worktree: `/Users/alireza/.codex/worktrees/telegram-ads-automation/Telegram_bots`.
- Branch: `codex/ads-reviewable-decisions`. PR #484 merged; follow-up makes calibration messages show the actual target, copy, sources, hypothesis and financial effect, with an explicit disabled-gate notice. Preserve a configured server Google credential path across future deployments only when the ignored credential file exists. The speculative SQLite downgrade was reverted because mtcute still requires SQLite 12; no dependency downgrade is pending. Server native probes (SQLite query, sharp encode, mtcute import) passed and the verified installation fingerprint was recorded for reuse.
- User's original dirty checkout must remain untouched.
