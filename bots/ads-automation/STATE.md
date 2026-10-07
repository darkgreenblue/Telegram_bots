# Automation checkpoint

Updated: 2026-10-06. This file records verified progress and outstanding work; credentials must never appear here.

## Latest verified checkpoint (takes precedence over historical entries below)

- PRs #489 and #490 are merged and deployed. Normal Deploy run 37472391533 actually executed `Deploy to VPS` successfully at 13:38:34–13:40:48 UTC (17:08–17:10 Tehran) for main `3f51281cb7c6c91b263db58d21bb8a8e5ab16c25`. Fresh readonly VPS evidence at 15:31:11 UTC confirmed that SHA includes `d6a7e186b2140a539522bb690492ee6c8f710259`.
- PM2 ads-automation online, PID 3826927, restart counter 6; worker 4581927f-9244-4b89-b18f-da48098170e6 has a fresh lease and three recent completed cycles. Both actual financial gates are 0, managed Ads IDs 0, financial operations 0, allocation/commitment 0. Project's approved pilot ceiling is still 3 TON; that ceiling is not a spend reservation. Only the server polls the admin bot. Evidence: ignored `data/verification/discovery-review-2026-10-06/deployment-proof.json`.
- Previous deployment-verification heartbeat was PAUSED after completion. PR #493 contains the new discovery changes on `codex/ads-discovery-evidence`; they are tested locally and awaiting CI/review and normal safe-window deployment. Do not claim they are already running on the VPS.
- Owner approved the European adult-character banner direction, including the more visible pink CTA and amber headline. Accepted preview: ignored `data/verification/creative-reference-2026-10-06/chatgpt-european-pink-cta-v3.png`. This is not an Ads upload or a paid experiment. Creative 8 and its old controlled-cost proposal remain held.
- Initial discovery must start with established direct competitors. Owner explicitly approved minimum 5,000 channel subscribers / 10,000 bot monthly users. Unknown/tiny/adjacent peers remain in the repository; search/user hypotheses remain supported but are held from the initial competitor baseline. No arbitrary count quota justifies a weak peer.
- Five anonymous provider paths passed a real local no-spend probe: Lyzem, Telemetr.com channels, Telemetr.com ad destinations, GramBots and Telegramic. `tarot`, language hint `en`: 36 unique seeds, 30 validation attempts, 22 actual channels/bots, 8 unknown-size peers, 9 above size floor (not market-eligible), 4 recently active channels above floor. All 22 were queued for relevance/market review; financial operations 0. Actual third-party language errors and demo responses were rejected/qualified. See `DISCOVERY-REVIEW.md` and `DISCOVERY-BENCHMARK.json`.
- 80 local tests passed; three applicable repository checks and undefined-function check passed. Source acquisition is bounded, durable, deduplicated, rate-limited and independent of protective Ads polling. Interrupted runs use leases and fenced completions; all-provider outage is not valid empty discovery. Upstream test suites were not executed.
- Native public search / similar bot and channel adapters have behavioral tests only. Owner selected a separate discovery user account; its phone number/setup is pending. No session on the owner's personal account was created. Native full-text public post search is not auto-enabled: respect free-slot and manual-initiation requirements; no Stars payment fallback.
- First paid target is not chosen yet. The question about @HoroscopesOfLoveBot versus larger multilingual rivals is pending; no answer is inferred. @HoroscopesOfLoveBot had 23,667 directly observed monthly users and English presentation; the larger directly measured rivals have Russian profiles and uncertain English audience share.
- Next: review/merge the discovery changes, deploy in a permitted normal window, apply `discovery-policy` for project 1 only after that code is deployed, enqueue bounded public queries, restart the idle local brain to load `peer_review`, and verify server review jobs/Sheets. Keep both financial gates disabled and do not mutate Ads. Complete the separate account setup and real market/financial acceptance afterwards.

## Approved pilot

- English globally, no country restriction; destination `@TAROOT_RU_BOT`.
- CPA target: 0.05 TON per action. Approved pilot spend ceiling: 3 TON; actual server spend reservations remain zero.
- Allocation limit: 20 TON, at most 20 independent campaigns, initially 1 TON each.
- Each test round may consume 0.05 TON in total across calendar days.
- Calibration remains enabled. Existing campaigns are outside automation authority.
- Owner explicitly authorized the agent to generate/download Gemini images through the browser and reply to the admin bot. Only alirezaoliyaforspotify@gmail.com with Pro may be used; verify the active account first. No paid image API is authorized.

## Verified implementation

- PRs #473, #477 and #481 merged: server workflow, separate allocation/spend reservations, strict research output schema.
- Server uses `/home/ubuntu/voice2text`, SSH alias `vps`, PM2 process `ads-automation`.
- Native SQLite installation completed after installing build tools. PR #483 merged as `8d717224d8932b3185f46edd6ce54e06fbc8b96e`; Deploy run 37320588476 executed Deploy to VPS successfully in about two minutes. Server HEAD matched the merge and ads process was online with restart counter 2.
- Project 1 (`tarot-en-global-2026`) registered in calibration with 20 research seeds. No live experiments created.
- Product scope `tarot-intl@en` resolves to the existing destination. Per-version attribution bridge is implemented; real attribution round trip remains to be checked.
- Admin bot: `@AliAdsOpsControlBot`. Server owns polling; no competing local poller is authorized.
- Latest local suite: 47 tests passed; all 22 selected repository CI checks passed.
- Research job 1 completed through the actual subscription-backed Codex/SSH round trip. The store has 39 candidates; 20 strategy jobs, 20 copy jobs and all 6 channel image-prompt jobs completed. All six banner prompts have received real owner image replies and passed subscription vision QA; 20 draft experiments await calibration approval, and no paid pilot Ads exist. An independent unfunded capability probe is recorded below.
- Local worker installed as `org.alireza.telegram-ads-brain` in `~/Library/LaunchAgents/`; observed running after a safe idle restart to load the Persian owner-language prompt updates (PID 99199). Logs: `data/brain-logs/`. It processes brain jobs only, never polls the admin bot.
- PR #483 fixes deployment timeout/repeated native builds, research URL/target contracts, duplicate/stale banner replies and long-prompt truncation. Server deployment passed. The actual `/status` handler delivered to the owner through Telegram without starting another poller.
- Actual product `stats_all` bridge passed for `tarot-intl@en`: Stars unit, payment events supported, one existing attribution code. Actual campaign-code creation and retry idempotency passed for experiment 1; user-entry/payment attribution still needs verification.
- User approved creating a dedicated Google service account in `tg-voice2text-bot`, editor of only the Ads sheet, with its key on the VPS. Existing Cloud SDK scope set was verified before renewal. Owner phone authentication completed. Dedicated account `telegram-ads-mirror@tg-voice2text-bot.iam.gserviceaccount.com` was created without project IAM roles; only the specified spreadsheet was shared as writer. Ignored key installed with mode 600 locally and on VPS; a real Sheets metadata read with that key passed.
- Existing manual Sheet rows were preserved as native duplicates: Archive Candidates 2026-10-05 (864660455), Archive Tests 2026-10-05 (491827409), Archive Insights 2026-10-05 (1808106150). Original three tabs remain first; sampled candidate values match their archived copy.
- Ads API page recovered. The first clipboard read returned no complete token, but a later supported clipboard-item read after the copied confirmation recovered the existing token. Stored only in ignored local/VPS `data/ads-api-token.txt` with mode 600. No revocation or new access occurred; the previous replacement question is obsolete. Actual read-only getCurrentAccount succeeded and reported currency TON. The official API documentation subsequently loaded in the authenticated browser; its visible text was saved as ignored verification evidence. No financial write was attempted.

## Remaining acceptance work

1. PR #484 startup/Sheets deployment passed (run 37323911810). PR #485 reviewable approvals deployed as 04c7624dac334317d430226eabd2f269099fea7f: run 37325994654 Deploy to VPS succeeded at 14:37:34 UTC. Server SHA matched. After the previous 120-second worker lease expired, the new owner renewed the lease and completed three cycles; PM2 online with restart counter 4. Actual Telegram Web /status returned 14 prepared tests and zero allocation/spend commitment. All 14 existing pending approval messages were refreshed with target, copy, Persian explanation, sources and financial effects; no approval state changed.
2. Real research → 20 strategies → 20 copies → 6 image prompts passed with the installed local worker; all six prompts were delivered. All six real owner image replies and visual QA passed on October 6. The correction path passed separately using an intentionally misspelled test image; no real Gemini output required correction.
3. Real product link creation passed for experiment 1: two calls returned the same c_CODE, persisted on the draft experiment, and the real per-code stats bridge returned the Stars unit. No product-user entry or payment was fabricated. Real entry/refund attribution remains pending.
4. Real VPS Sheet write passed with 39 candidates and 10 draft tests. Independent connector reads confirmed the new values and preserved Brazil archive. Periodic sync passed at cycle 20: the server updated the Sheet to 39 candidates and 14 drafts without an operator call. No worker errors were recorded. Original research evidence is unchanged; the selected 20 candidates have Persian owner explanations in features metadata.
5. Real admin document replies and vision QA passed for all six Gemini images; repeat correction remains separately verified on controlled spelling-test images.
6. Authorized read-only Ads API access passed. Conduct explicitly approved controlled account validation before enabling spend.

## Gates and limitations

- `ADS_LIVE_ENABLED=0` and `ADS_COST_GATE_VERIFIED=0`. Existing Ads token is stored in the ignored protected file; automatic loading is implemented without opening either gate. No pilot advertising has been funded or activated. One explicitly approved isolated, unfunded search probe was created; older Ads are unchanged.
- Exact provider-side 0.05 TON enforcement, actual daily reset, precision and delayed-statistics behavior are not yet account-verified.
- Net product revenue cannot be claimed until per-code refunds are available.
- Public-channel evidence is a hypothesis, not proof of Ads inventory availability or audience country.
- Google service account is configured on the server and real writes passed. Account has no project-wide IAM role. Periodic sync passed at cycle 20 with the current draft count.

## Current working copy

- Managed worktree: `/Users/alireza/.codex/worktrees/telegram-ads-automation/Telegram_bots`.
- Branch: `codex/ads-server-verified-checkpoint`. PRs #484 and #485 merged and actually deployed; documentation checkpoint #486 merged. Calibration messages show the target, copy, sources, Persian hypothesis and financial effects with an explicit disabled-gate notice. Preserve a configured server Google credential path across future deployments only when the ignored credential file exists. The speculative SQLite downgrade was reverted because mtcute still requires SQLite 12; no dependency downgrade is pending. Server native probes (SQLite query, sharp encode, mtcute import) passed and the verified installation fingerprint was recorded for reuse.
- User's original dirty checkout must remain untouched.

## Acceptance remains incomplete

- Actual getCurrentAccount passed with the existing token; no token replacement or answer to the old question is needed. Spending capability tests remain unapproved and unverified.
- Real owner banner replies and production vision QA passed for all six creatives. Production campaign-acquired entry, late-payment and refund attribution are not accepted yet; the isolated real-code bridge checks passed.
- Before enabling live spend, audit API rate-limit cooldowns, uncertainty reconciliation, provider precision/leases and decision/learning behavior against real account responses. Passing the no-spend simulation does not establish those account behaviors.
- The initial heartbeat `verify-telegram-ads-no-spend-deploy` is already PAUSED; there is no active redundant deploy monitor.

## Recovery validation checkpoint

- Real Codex vision accepted the synthetic image reading `Daily reflection` and rejected `Daily refelction`, identifying the spelling error. The same structured output went through the actual submission path into an isolated database: incorrect image -> qa_failed + correction job; corrected revision -> prepared 1280x720 JPEG + approved. Evidence: ignored `data/verification/vision-1791212784221/evidence.json`. No real campaign creative was replaced and no live Ads calls occurred. Owner subsequently authorized browser-assisted generation on the specified Gemini Pro account; current delivery evidence is recorded below.
- Necessary recovery fixes: persist account-wide API cooldown across restarts; defer long provider limits without sleeping inside the worker; preserve the exact initial create request after an uncertain response; stop replay if that request expired or its other fields changed. Completed brain outputs may be acknowledged again without applying twice. Interrupted image preparation reuses only an identical artifact; stale/expired image jobs cannot prepare output.
- Actual shared start-attribution and dashboard bridge exercised on temporary product/platform databases: campaign creation is idempotent, new and returning users stay separate, a returning organic payer does not become campaign-acquired, pending payments are excluded, and a late approved Stars payment appears on the next bridge read. Refunded-status exclusion passed; separate refund amounts remain unavailable in the current bridge.
- These checks do not establish provider account capabilities, real conversion profitability or production refund attribution. Both financial gates remain disabled.
- Further plan gaps to resolve before enabling automatic decisions: stable shared hypothesis grouping and product-version validity on insights; decision feedback that uses comparable-age payment quality rather than only CPA; controlled provider-side enforcement and verified daily reset. Current calibration is required, and a no-spend deployment is not full live-pilot acceptance.

- A matching provider title without persisted local create history is rejected; the automation cannot adopt an old campaign merely because its title matches. A consistent live SQLite backup was reopened readonly and passed integrity/foreign-key checks with 39 candidates, 14 drafts, 47 completed jobs and zero Ads/financial operations. Evidence on VPS: `data/backups/acceptance-2026-10-05T15-13-51.785Z.db.json`.

- Read-only getAdsList, getAdsById and getAdStats passed with the existing token. The account has seven older Ads (six active, one stopped); none were adopted or altered. Sampled active responses omit optional is_paused, so inactivity checks support stopped/on_hold without that field. Stats are an array. Financial operations in this service remain zero.

## Server acceptance checkpoint after PR #487

- PR #487 merged as `fc0f46fe5a1f04a538ee3da59c0e5e0a1f606e2f`. Deploy run 37332838987 executed Deploy to VPS successfully from 15:26:36 to 15:28:08 UTC (18:56–18:58 Tehran), without an urgent bypass. Server HEAD matched the merge.
- Actual VPS Node 20.20.2 suite passed all 47 tests. PM2 ads-automation online, PID 3746916, restart counter 5. New worker owner 71ece8ec-ef35-4675-9681-a67f3a3ea436 claimed/renewed its lease and completed three cycles. Financial gates stayed 0; managed Ads and operations stayed 0. Existing token file mode is 600. No local admin poller was started; the subscription brain LaunchAgent remains running.
- Actual product configuration confirms the retained tarot-ru process serves LOCALE=en and LANGS=en,es,ru,pt; the old process name does not mean the pilot is Russian-only.
- Official docs https://ads.telegram.org/docs/api loaded. They confirm two-decimal CPM/budget precision for currency code TON, 24-hour idempotency retention, minute rounding of activation/deactivation times, and that editAd with is_paused resets prior activation/deactivation dates. Therefore the earlier suspected winner-deadline defect is not supported by the documented contract; no speculative zero-date workaround was applied. Actual cost/daily-reset verification is still required.
- The owner explicitly approved one unfunded paused search Ad (annotation 1). The tracked URL request was rejected with POST_URL_START_NOT_ALLOWED, and a read-only title reconciliation found no Ad. The corrected plain destination request created Ad 77; getAdsById and the actual account UI confirmed is_paused=true, status=stopped, spent_budget=0, remaining_budget=0, views=0, daily_budget_limit=0.05 and cpm=0.1. The search provider discarded the submitted ad text (returned empty text). Durable request/approval/ID history is in the independent `data/ads-api-validation.db`, never the primary worker database. Ignored evidence: `data/verification/api-unfunded-preflight-result.json` and `ads-unfunded-77.jpg`. Both normal gates remain disabled; older Ads unchanged. The operator proof initially read a wrong spent field and issued an extra protective pause to this owned Ad only; final verification uses the actual spent_budget field. This does not establish spending enforcement, daily reset or paid search attribution. The owner has been asked whether paid search must stay blocked until attribution is solved or may use Telegram-only action metrics; no answer is assumed.

- Actual Telegram Web /status after deployment returned the 14-draft, calibration, zero-allocation/commitment state. The user-facing word test currently includes drafts; these are not live campaigns. DOM verified the response. `data/verification/admin-after-deploy-2026-10-05.jpg` shows banner-prompt delivery, not the offscreen status response.

## Browser-assisted creative checkpoint

- Gemini active-account link confirmed alirezaoliyaforspotify@gmail.com and Pro before sending any prompt. Image mode and 16:9 selected. Generated original images are retained with prompt hashes, revision, account and conversation provenance in ignored `data/verification/gemini/manifest.json`.
- All six originals (creatives 8, 11, 12, 14, 19 and 20) were downloaded from the authorized Pro account and sent as documents replying to the exact current prompt messages 26–31 through real owner Telegram Web. Server accepted each submission; subscription Codex vision jobs 48–53 approved exact text/language and prepared six 1280×720 JPEGs. Job 48 retried one model timeout and applied once; the other five completed on their first attempts. Ignored proof: `data/verification/gemini-banner-acceptance.json`. No image was uploaded to Ads or used for spending.
- The primary store now has 39 candidates, 20 draft experiments, 53 completed brain jobs and zero managed Ads IDs. Actual Telegram Web /status returned 20 prepared tests, calibration mode and zero allocation/commitment on October 6; screenshot `data/verification/admin-20-drafts-2026-10-06.jpg` contains that real response. These 20 tests are drafts, not live campaigns.


## Controlled cost-test proposal (not executed)

- Experiment 15 / creative 8 targets @BotsArchive. The real dashboard returned the unique campaign code c_6FjdC; it was persisted on this draft only, with product.tracking.prepared audit. No paid campaign was created.
- Reviewable protected proposal: `data/verification/controlled-cost-test-plan.json`, awaiting explicit owner approval. Start with one zero-budget paused channel Ad, verified JPEG and tracked destination; allocate at most 1 TON while paused; after the documented inactive wait return 0.95 TON and verify exactly 0.05 TON remains before any activation. If readback/reduction fails, keep paused and never substitute a larger exposure. The proposed display uses CPM 0.18, daily limit 0.05 and a provider stop within two minutes. Both normal gates remain disabled; no older Ads may be altered.
- This proposal does not verify daily reset or prolonged review/statistical delays, and does not authorize the rest of the pilot. Approval is pending; no elapsed waiting time is treated as approval.

## Remaining full-plan implementation gaps

- Stable shared hypothesis identities and product-version validity are not yet implemented; grouping exact prose is insufficient for cross-channel learning. Existing selected hypotheses are separate narratives, so product-wide promotion cannot be assumed.
- Comparable-age payment snapshots and research/strategy/decision evidence are now implemented locally for the owner-approved 7/30-day windows. They are pending deployment and do not implement automatic financial optimization or insight promotion. Refund amounts remain unavailable; do not report net profitability.
- The preparation-queue defect for new approved creatives on an already tested candidate is fixed locally: each creative gets its own pending owner decision, identical preparation is idempotent, and drafts still occupy the campaign cap. Automatic choice of repeat-test hypotheses/angles and negative-insight promotion remain incomplete; this fix alone does not implement the entire experimentation planner.
- Optional MTProto discovery/enrichment is not configured and is not automatically run for every candidate. Public-source research worked; that is not a complete inventory-availability check.
- Paid search attribution remains unresolved because the real provider rejects bot start parameters. Search must not silently become an untracked paid experiment while the owner decision is pending.
- Browser Gemini generation now works hands-on but still depends on an available desktop/browser session; it is not an unattended server image API. The server safely waits for images when that path is unavailable.


## October 6 preparation recovery

- Real periodic Sheet sync now reports 39 candidates, 20 draft tests and zero insights. A separate service-account read confirmed 20 rows, all draft and all provider IDs blank; no operator sync call was used. Primary store has 53 completed jobs. Worker lease was fresh and the latest three cycles completed.
- Local preparation recovery adds one pending create decision per approved creative, including new variants for prepared candidates. It never calls Ads or grants spending. Replays return the original experiment; changing its bid or using another candidate's creative is rejected. Deleted experiment evidence remains present, and the slot limit includes drafts. Four new behavioral checks passed; the complete local suite now passes 51 tests. Deployment of this new code is pending.


## Owner feedback and cohort work in progress

- PR #489 merged as 8f834042f411f198d487fa276591509280502952 after CI run 37449536673 passed. Deploy run 37449862803 deferred outside the safe window; its Deploy to VPS step was skipped. Server remains on verified PR #487 until a later normal deployment. No urgent bypass.
- Owner explicitly approved 7-day payment comparison with the proposed 30-day review. New branch codex/ads-payment-cohorts adds read-only acquisition/approval-time cohorts, preserving product versions, maturity and missing-data distinctions. Work is not yet merged/deployed.
- Owner objected to banner 8's advertising quality. Technical text/language/size QA does not establish marketing suitability. Creative 8 is now needs_review in the primary store; experiment 15 still has no provider ID. The protected controlled-cost proposal is held_for_creative_review and must not execute with that image even if its earlier approval question receives an answer. Existing technical QA evidence and original image are preserved.
- Owner asked to wait for successful Persian banner examples/prompts, noting ex-return/partner-feelings angles worked to some extent and other angles were not tested. Wait for those references before producing replacements. Owner also authorized evaluating the available ChatGPT image tool against Gemini; no model/provider superiority is established yet. The English hypotheses must retain the limited scope of the Persian evidence.


## Comparable-age payment acceptance (local and read-only)

- Owner approved 7-day comparison with 30-day review. Read-only cohorts use actual new campaign-acquisition start and approved_at payment time. Organic returning payers, admin/test users, immature users, pending and refunded-status payments are excluded from bounded successful-payment quality. Missing acquisition or payment times remain unknown; product versions stay separate. Gross revenue is not net profit.
- All 55 local tests pass. Behavioral coverage includes 7/30-day maturity, payment-window boundaries, product versions, late inserted payment records, organic returns, administrator/test exclusion, unavailable schema/timing, and the actual dashboard bridge running against isolated product databases. Admin decision evidence includes the age-window results without increasing spend authority.
- Actual product database readonly validation passed in 76 ms with approval-time schema present and two tracked codes. Zero mature or newly acquired campaign users exist yet; this is schema/integration acceptance, not live payment acceptance. Protected server evidence: data/verification/cohorts-readonly-acceptance.json.
- Payment snapshots now enter research and strategy input and fresh admin proposal evidence. Only material changes in cohort metrics trigger payment feedback research; advancing snapshot timestamps alone does not. The existing automatic financial decision rule still needs separate completion/acceptance before leaving calibration.
- Six original images passed technical QA; creative 8 is now held for marketing review. No replacement image should be generated until the requested Persian references arrive. The old controlled cost-test approval must not override this hold.

## Owner creative references received (2026-10-06)

- Installed the owner-provided `extract-share-link` skill locally after inspecting both Markdown and script; no paid API or new account access.
- Extracted the full rendered Claude share conversation (49,222 characters). It concerns intro images/translations; hidden attachments are unavailable. The original Persian Ads prompt and Korean-character revision were separately visible in the approved Gemini account and saved locally.
- Three owner-provided banners and source hashes are preserved in ignored `data/verification/creative-reference-2026-10-06/`. Initial English creatives should follow this reference family: relationship question, photographic adult character/card, large readable headline and CTA; adapt visual style to evidenced peer context.
- Owner reports some Persian success for ex-return/other-person-feelings angles and anime-channel character adaptation. No controlled numbers were supplied; English demographics, ROI and transfer remain hypotheses.
- Started a paired ChatGPT built-in image / Gemini Pro comparison with the same English prompt and first reference. Preview only; no creative approval or Ads activation. Creative 8 and its earlier paid-test proposal stay held.
