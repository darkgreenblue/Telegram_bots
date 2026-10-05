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
- Latest local suite: 46 tests passed; all 22 selected repository CI checks passed.
- Research job 1 completed through the actual subscription-backed Codex/SSH round trip. The store has 39 candidates; 20 strategy jobs, 20 copy jobs and all 6 channel image-prompt jobs completed. All six banner prompts have Telegram message IDs with status sent; 14 draft experiments await calibration approval, and no Ads exist.
- Local worker installed as `org.alireza.telegram-ads-brain` in `~/Library/LaunchAgents/`; observed running after a safe idle restart to load the Persian owner-language prompt updates (PID 99199). Logs: `data/brain-logs/`. It processes brain jobs only, never polls the admin bot.
- PR #483 fixes deployment timeout/repeated native builds, research URL/target contracts, duplicate/stale banner replies and long-prompt truncation. Server deployment passed. The actual `/status` handler delivered to the owner through Telegram without starting another poller.
- Actual product `stats_all` bridge passed for `tarot-intl@en`: Stars unit, payment events supported, one existing attribution code. Actual campaign-code creation and retry idempotency passed for experiment 1; user-entry/payment attribution still needs verification.
- User approved creating a dedicated Google service account in `tg-voice2text-bot`, editor of only the Ads sheet, with its key on the VPS. Existing Cloud SDK scope set was verified before renewal. Owner phone authentication completed. Dedicated account `telegram-ads-mirror@tg-voice2text-bot.iam.gserviceaccount.com` was created without project IAM roles; only the specified spreadsheet was shared as writer. Ignored key installed with mode 600 locally and on VPS; a real Sheets metadata read with that key passed.
- Existing manual Sheet rows were preserved as native duplicates: Archive Candidates 2026-10-05 (864660455), Archive Tests 2026-10-05 (491827409), Archive Insights 2026-10-05 (1808106150). Original three tabs remain first; sampled candidate values match their archived copy.
- Ads API page recovered. The first clipboard read returned no complete token, but a later supported clipboard-item read after the copied confirmation recovered the existing token. Stored only in ignored local/VPS `data/ads-api-token.txt` with mode 600. No revocation or new access occurred; the previous replacement question is obsolete. Actual read-only getCurrentAccount succeeded and reported currency TON. Official docs page still resets the browser connection. No financial write was attempted.

## Remaining acceptance work

1. PR #484 startup/Sheets deployment passed (run 37323911810). PR #485 reviewable approvals deployed as 04c7624dac334317d430226eabd2f269099fea7f: run 37325994654 Deploy to VPS succeeded at 14:37:34 UTC. Server SHA matched. After the previous 120-second worker lease expired, the new owner renewed the lease and completed three cycles; PM2 online with restart counter 4. Actual Telegram Web /status returned 14 prepared tests and zero allocation/spend commitment. All 14 existing pending approval messages were refreshed with target, copy, Persian explanation, sources and financial effects; no approval state changed.
2. Real research → 20 strategies → 20 copies → 6 image prompts passed with the installed local worker; all six prompts were delivered. Actual owner image reply / visual QA / correction remains pending.
3. Real product link creation passed for experiment 1: two calls returned the same c_CODE, persisted on the draft experiment, and the real per-code stats bridge returned the Stars unit. No product-user entry or payment was fabricated. Real entry/refund attribution remains pending.
4. Real VPS Sheet write passed with 39 candidates and 10 draft tests. Independent connector reads confirmed the new values and preserved Brazil archive. Periodic sync passed at cycle 20: the server updated the Sheet to 39 candidates and 14 drafts without an operator call. No worker errors were recorded. Original research evidence is unchanged; the selected 20 candidates have Persian owner explanations in features metadata.
5. Exercise admin reply/image QA and correction flow with real image input.
6. Authorized read-only Ads API access passed. Conduct explicitly approved controlled account validation before enabling spend.

## Gates and limitations

- `ADS_LIVE_ENABLED=0` and `ADS_COST_GATE_VERIFIED=0`. Existing Ads token is stored in the ignored protected file; automatic loading is implemented without opening either gate. No advertising has been created, funded or altered by this work.
- Exact provider-side 0.05 TON enforcement, actual daily reset, precision and delayed-statistics behavior are not yet account-verified.
- Net product revenue cannot be claimed until per-code refunds are available.
- Public-channel evidence is a hypothesis, not proof of Ads inventory availability or audience country.
- Google service account is configured on the server and real writes passed. Account has no project-wide IAM role. Periodic sync passed at cycle 20 with the current draft count.

## Current working copy

- Managed worktree: `/Users/alireza/.codex/worktrees/telegram-ads-automation/Telegram_bots`.
- Branch: `codex/ads-recovery-validation`. PRs #484 and #485 merged and actually deployed; documentation checkpoint #486 merged. Calibration messages show the target, copy, sources, Persian hypothesis and financial effects with an explicit disabled-gate notice. Preserve a configured server Google credential path across future deployments only when the ignored credential file exists. The speculative SQLite downgrade was reverted because mtcute still requires SQLite 12; no dependency downgrade is pending. Server native probes (SQLite query, sharp encode, mtcute import) passed and the verified installation fingerprint was recorded for reuse.
- User's original dirty checkout must remain untouched.

## Acceptance remains incomplete

- Actual getCurrentAccount passed with the existing token; no token replacement or answer to the old question is needed. Spending capability tests remain unapproved and unverified.
- Real owner banner reply, real product-user entry and late-payment/refund attribution are not accepted yet.
- Before enabling live spend, audit API rate-limit cooldowns, uncertainty reconciliation, provider precision/leases and decision/learning behavior against real account responses. Passing the no-spend simulation does not establish those account behaviors.
- The initial heartbeat `verify-telegram-ads-no-spend-deploy` is already PAUSED; there is no active redundant deploy monitor.

## Recovery validation checkpoint

- Real Codex vision accepted the synthetic image reading `Daily reflection` and rejected `Daily refelction`, identifying the spelling error. The same structured output went through the actual submission path into an isolated database: incorrect image -> qa_failed + correction job; corrected revision -> prepared 1280x720 JPEG + approved. Evidence: ignored `data/verification/vision-1791212784221/evidence.json`. No real campaign creative was replaced and no live Ads calls occurred. Owner/Gemini reply remains the approved manual v1 step.
- Necessary recovery fixes: persist account-wide API cooldown across restarts; defer long provider limits without sleeping inside the worker; preserve the exact initial create request after an uncertain response; stop replay if that request expired or its other fields changed. Completed brain outputs may be acknowledged again without applying twice. Interrupted image preparation reuses only an identical artifact; stale/expired image jobs cannot prepare output.
- Actual shared start-attribution and dashboard bridge exercised on temporary product/platform databases: campaign creation is idempotent, new and returning users stay separate, a returning organic payer does not become campaign-acquired, pending payments are excluded, and a late approved Stars payment appears on the next bridge read. Refunded-status exclusion passed; separate refund amounts remain unavailable in the current bridge.
- These checks do not establish provider account capabilities, real conversion profitability or production refund attribution. Both financial gates remain disabled.
- Further plan gaps to resolve before enabling automatic decisions: stable shared hypothesis grouping and product-version validity on insights; decision feedback that uses comparable-age payment quality rather than only CPA; provider-side winner lease behavior and verified API formats. Current calibration is required, and a no-spend deployment is not full live-pilot acceptance.

- A matching provider title without persisted local create history is rejected; the automation cannot adopt an old campaign merely because its title matches. A consistent live SQLite backup was reopened readonly and passed integrity/foreign-key checks with 39 candidates, 14 drafts, 47 completed jobs and zero Ads/financial operations. Evidence on VPS: `data/backups/acceptance-2026-10-05T15-13-51.785Z.db.json`.
