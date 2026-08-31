# کیفیت زبان روسی در LLM ها: تحقیق جامعه‌محور
**Research date:** 2026-08-31 · **Scope:** which OpenRouter-available models actually write natural, idiomatic, emotionally-resonant Russian prose (600 to 1200 words), what breaks, and what it costs.

> **Method note up front.** In this sandbox reddit.com, habr.com, huggingface.co, arxiv.org, vc.ru, openrouter.ai, wikipedia and many Russian media sites are blocked by the egress proxy. Only `github.com` / `raw.githubusercontent.com` were directly fetchable. Everything else was reached only through WebSearch result snippets and the search tool's page synthesis, which I mark explicitly as **[snippet-only, unverified]**. Where I had real bytes I say **[verified]** and, in two places, I ran my own aggregation over primary data files. See محدودیت‌های این تحقیق at the end.

---

## خلاصه

- **بهترین شواهدِ واقعی که پیدا شد یک بنچمارکِ روسیِ فعال به نام RuQualBench است** که «تعداد خطاهای زبانِ روسی به ازای هر ۱۰۰۰ توکن» را می‌سنجد و لاگ‌های خامش در گیت‌هاب کامیت شده. من خودم آن لاگ‌ها را دانلود کردم و جدول را از نو ساختم (۳۲ مدل × ۳ ران × ۱۰۰ پرامپت، اکتبر ۲۰۲۵، داورِ Gemini 2.5 Pro). نتیجه: **Claude Sonnet 4.5** بهترین (۰٫۳۷ خطا/۱۰۰۰ توکن)، بعد **Vistral-24B** و **Gemini 2.5 Flash** (هر دو ~۰٫۵۲)، بعد **GPT-4o** (۰٫۵۸)، **DeepSeek V3** (۰٫۶۱)، **Gemma-3-27b-it** (۰٫۶۸). در انتهای جدول: **GPT-5 با reasoning پایین (۱٫۶۷ تا ۲٫۰۴)** و **GPT-OSS-120B (۲٫۱۳)**. یعنی خانواده‌ی GPT-5 mini/GPT-5 برای نثرِ روسی گزینه‌ی ضعیفی است و **Gemini 2.5 Flash که همین حالا استفاده می‌کنید در ردیفِ بالای جدول است.**
- **مشکلِ جنسیتِ شما یک باگِ محلی نیست، یک شکستِ شناخته‌شده‌ی سیستمی است.** پرامپتِ داورِ همان بنچمارک «مشکلِ تطابقِ رود» را **سطح ۳ یعنی شدیدترین سطح** تعریف کرده و برای «تغییرِ رود بین پیام‌ها» یک نوعِ خطای جداگانه ساخته. در ۱۶٬۱۶۱ توضیحِ خطایی که استخراج کردم، **۱۱٫۵٪ مستقیماً دربارهٔ «род» است** و **۲۰٫۳٪ دربارهٔ падеж/согласование**. هیچ مدلی صفر نیست؛ حتی Sonnet 4.5 هم ۰٫۰۵۷ خطای جنسیتی به ازای هر ۱۰۰۰ توکن دارد. **پس راه‌حل باید محصولی باشد نه پرامپتی**: یا جنسیت را از کاربر بپرسید، یا متن را به ساختارهای بی‌جنسیت مجبور کنید.
- **نشتِ «вы» هم مستند است.** در همان لاگ‌ها ۱۱۸ مورد از داور دربارهٔ شکلِ خطاب پیدا کردم، از جمله دقیقاً همان الگوی شما روی Gemini 2.5 Flash: «в основной части используется форма 'вы', но в одном месте происходит переход на 'ты'». یعنی مدل‌ها ты/вы را **در میانه‌ی متن** رها می‌کنند، نه اینکه از اول اشتباه شروع کنند. گاردِ درست، پس-پردازشِ متن است نه تکرارِ دستور در پرامپت.
- **مدل‌های بومیِ روسی (Yandex، GigaChat، T-Pro، Vikhr، Saiga، Ruadapt) روی OpenRouter نیستند.** کاتالوگِ OpenRouter (از طریق مخزنِ models.dev که تازه است و Gemini 3.7 Flash را دارد) ۶۱ سازنده دارد و هیچ‌کدام از این‌ها در آن نیست. اگر بخواهید، فقط از راهِ API مستقیمِ خودشان یا self-host ممکن است، که برای شما یعنی زیرساختِ جدید. **توصیه: سراغشان نروید.** ضمناً در همان بنچمارک GigaChat-20B و YandexGPT-5-Lite از Gemini 2.5 Flash بدتر بودند.
- **هزینه: روسی حدود دو برابرِ انگلیسی توکن می‌خورد.** من روی همان لاگ‌ها اندازه گرفتم: خروجیِ روسی بین **۱٫۸ تا ۲٫۵ توکن به ازای هر کلمه** است (Gemini 2.5 Flash ≈ ۲٫۱۷، GPT-4o ≈ ۲٫۰، Sonnet 4.5 ≈ ۲٫۲۸، DeepSeek V3 ≈ ۲٫۳۷). یعنی یک فالِ ۶۰۰ تا ۱۲۰۰ کلمه‌ای تقریباً **۱۳۰۰ تا ۲۹۰۰ توکنِ خروجی** است. مقاله‌ی دانشگاهیِ ۲۰۲۶ هم برای روسی ۲٫۲ تا ۲٫۵ توکن بر کلمه در برابر ۱٫۲ برای انگلیسی گزارش کرده [snippet-only].
- **تصمیمِ عملی:** روی **Gemini 2.5 Flash بمانید** (ارزان: ۰٫۳/۲٫۵ دلار، و در رتبه‌ی سوم کیفیتِ روسی)، **GPT-5 mini را برای این کار انتخاب نکنید**، و اگر بودجه اجازه داد یک آزمایشِ A/B با **Claude Sonnet 4.5** یا **Gemini 3.x Flash** بزنید. **Gemma-3-27b-it** روی OpenRouter با ۰٫۰۸/۰٫۴۵ دلار یک گزینه‌ی فوق‌ارزانِ قابلِ قبول است.

---

## What communities actually say

### The single most useful artifact I found: RuQualBench

A Russian-native benchmark by GitHub user `kristaller486` that does **not** measure knowledge or reasoning. It measures only **how correct the Russian itself is**: an LLM judge counts Russian-language errors in a model's answer and explicitly ignores factual or code errors. Data comes from `writingprompts-ru`, `wikisource_preferences_ru`, `kalo_misc_part2_no_system_ru`, and `T-Wix`. Judge model: Gemini 2.5 Pro. Sizes: 100 / 250 / 500 prompts.
Source [verified, fetched]: https://github.com/kristaller486/RuQualBench · latest commits I could see: **23 June 2026** ("add qwen 3.6/3.5 27b"), so the project is actively maintained.

**Why it matters for you specifically:** the prompt corpus is dominated by long creative-writing tasks in Russian. In the 100-prompt "lite" set, the median answer is **~1100 completion tokens** and prompts include things like "текст объемом примерно 1100 слов, представляет собой притчу... повествование ведется от лица всезнающего рассказчика". That is almost exactly your workload (600 to 1200 word emotive Russian prose).

**The leaderboard.** The public leaderboard lives on a Hugging Face Space that I could **not** reach (blocked). But the repo commits its raw run logs. I downloaded 96 of them and recomputed the table myself. Errors per 1000 tokens, mean of 3 runs, lower is better:

| Model (as labelled in the logs) | all err / 1k tok | range (min–max) | critical / 1k tok |
|---|---|---|---|
| Claude Sonnet 4.5 | **0.37** | 0.31–0.46 | 0.067 |
| Vikhrmodels/Vistral-24B-Instruct | **0.51** | 0.50–0.52 | 0.083 |
| Gemini 2.5 Flash (GA) | **0.52** | 0.47–0.59 | 0.077 |
| GPT-4o | 0.58 | 0.52–0.68 | 0.027 |
| Qwen3-235B-A22B-Instruct-2507 (Vertex) | 0.60 | 0.50–0.72 | 0.093 |
| DeepSeek V3 (Novita) | 0.61 | 0.59–0.64 | 0.147 |
| Gemma-3-27b-it | 0.68 | 0.61–0.79 | 0.077 |
| Mistral-Small-3.2-24B-Instruct-2506 | 0.68 | 0.61–0.72 | 0.097 |
| MiniMax-Text-01 | 0.70 | 0.64–0.76 | 0.037 |
| RuadaptQwen3-32B-Instruct | 0.74 | 0.58–1.00 | 0.093 |
| Claude Haiku 4.5 | 0.85 | 0.75–0.90 | 0.120 |
| Qwen3-VL-32B-Instruct | 0.91 | | 0.117 |
| **DeepSeek V3.2-Exp** | **0.96** | 0.94–0.99 | 0.257 |
| YandexGPT-5-Lite-8B-instruct | 1.03 | 0.89–1.13 | 0.087 |
| T-pro-it-2.0 (no reasoning) | 1.09 | 0.97–1.22 | 0.257 |
| Qwen3-Next-80B-A3B-Instruct | 1.15 | | 0.190 |
| Qwen3-32B (no reasoning) | 1.26 | | 0.133 |
| GLM-4.6 | 1.37 | | 0.490 |
| Kimi-K2-Instruct-0905 | 1.48 | | 0.387 |
| **GigaChat-20B-A3B-instruct-v1.5** | **1.57** | 1.46–1.72 | 0.047 |
| **GPT-5 (reasoning: minimal)** | **1.67** | 1.61–1.75 | 0.303 |
| **GPT-5 (reasoning: low)** | **2.04** | 1.83–2.27 | 0.247 |
| GPT-OSS-120B | 2.13 | | 0.367 |
| MiniMax-M2 | 2.77 | | 0.457 |
| Mistral-Nemo | 2.82 | 2.43–3.15 | 0.513 |

Run timestamps: **2025-10-17 to 2025-10-28**. Judge: `gemini-2.5-pro`. Dataset: lite (100 prompts). Source files [verified, fetched]: https://github.com/kristaller486/RuQualBench/tree/main/logs

**Three things to take from this table:**
1. **DeepSeek V3 is fine, DeepSeek V3.2-Exp is materially worse** (0.61 → 0.96, and critical errors 0.147 → 0.257). If you are on `deepseek/deepseek-v3.2-exp` as a cheap fallback for Russian, that is a downgrade, not a sidegrade.
2. **The GPT-5 family is bad at Russian prose** relative to its price tier. Both GPT-5 configurations sit near the bottom. I did **not** find a RuQualBench entry for `gpt-5-mini` specifically, so treat "GPT-5 mini is bad at Russian" as an **inference from the GPT-5 rows**, not a measurement.
3. **Gemini 2.5 Flash is genuinely good here** and is the cheapest thing near the top.

**The author's own published summary** [snippet-only, could not open the HF Space]: best models are still closed source (Sonnet 4.5, Gemini, GPT-4o); among open models Gemma-3-27b-it and Vistral-24B are unrivalled; Ruadapt significantly reduces errors versus base Qwen; Qwen3 and GPT-OSS are "very bad, even worse than expected". This is consistent with the table I computed, which raises my confidence in it. Space URL (unreachable from here): https://huggingface.co/spaces/kristaller486/RuQualBench

### Russian-language consumer/blog press
[all snippet-only; these are SEO-heavy Russian content sites, treat as weak evidence]
- Claude and ChatGPT are usually named the leaders for Russian text; Claude is described as writing "без характерных нейросетевых штампов" and closer to a human intonation, ChatGPT as more stable at length. https://vc.ru/ai/3078021-luchshie-neiroseti-na-russkom-yazyke-besplatnye-servisy-i-chaty · https://study24.ai/blog/sravneniya/luchshaya-nejroset-dlya-napisaniya-teksta-2026/
- One Habr comparison piece states Gemini 3 Flash "хорошо понимает русский язык... однако в редких случаях может использовать кальки с английского" and that for nuanced Russian literary text "Claude Sonnet 5 точнее". Also a critical note that a newer Flash generation "генерирует текст так, словно это не нейросеть, а скрипт... исчезла вариативность, исчез контекстный тон". https://habr.com/ru/companies/bothub/articles/981870/ · https://habr.com/ru/articles/1038570/
- A Habr piece claims Russian text is only **6 to 8 percent** of global models' training data. **Single-sourced, unverified, and I could not open the article.** https://habr.com/ru/companies/korus_consulting/articles/888568/
- Vendor/aggregator pages claiming DeepSeek V3 "flawlessly understands Russian" are marketing copy and are **contradicted** by the measured RuQualBench numbers above for V3.2-Exp. https://deepseek-ru.ru/models/deepseek-v3/ · https://tools.pixelplus.ru/neyroseti/deepseek/

### English-language community
- A Hacker News thread is titled "Claude sucks at non English languages. Gemini and ChatGPT are much better. Grok ..." (surfaced as a Feb 2026 item). **I could not open it**, and the claim directly contradicts RuQualBench's Russian ranking, where Sonnet 4.5 is first. Report it as a live disagreement, not a fact. https://news.ycombinator.com/item?id=46905227
- I was **unable to reach any Reddit thread**, including r/LocalLLaMA. Every "reddit says" style claim in my search results traced back to the same RuQualBench author page rather than to an actual Reddit post. **I therefore have no genuine Reddit evidence to report**, despite that being an explicit ask.

---

## Russian-language benchmarks

| Benchmark | What it measures | Latest standing I could obtain | Date | Reachable? |
|---|---|---|---|---|
| **RuQualBench** | Pure Russian-language correctness, errors per 1000 tokens, LLM-judge, creative-writing-heavy corpus | See my recomputed table above | runs **Oct 2025**; repo active to **Jun 2026** | repo **[verified]**, leaderboard Space blocked |
| **MERA** (`mera.a-ai.ru`) | 21 tasks: knowledge, reasoning, code, in Russian. Aggregate score. **Not** prose naturalness | GigaChat 3.1 Ultra 0.712 > GPT-5.2 0.707 > GPT-4o 0.642 | reported "as of **20 July 2026**" | **blocked**; numbers **[snippet-only]**, and the sources are Sber's own PR (sber.pro, itweek.ru), so treat as vendor marketing |
| **ru_llm_arena** (VikhrModels, Arena-Hard-Auto port) | 500 prompts, 50 topics, GPT-4-judged side-by-side vs `gpt-3.5-turbo-0125` baseline; judge prompt modified to also grade Russian-language command; Bradley-Terry + length control | gpt-4-1106-preview 90.9 · gpt-4o-mini 83.9 · T-pro-it-1.0 83.8 · gigachat_max 82.7 · vikhr-nemo-12b 79.8 · gemma-2-9b-it 73.6 · T-lite 71.0 · qwen2.5-14b 70.5 · yandex_gpt_pro_v4 50.5 | table explicitly stamped **27.10.2024** | **[verified, fetched]** https://github.com/VikhrModels/ru_llm_arena · **badly stale**, contains no 2025/2026 model |
| **LLM Arena** (`llmarena.ru`) | Crowdsourced blind side-by-side in Russian, Elo + Bradley-Terry, plus an offline Arena-Hard of 500 prompts | none obtained | n/a | site **blocked**; only the GitHub README was readable **[verified]** https://github.com/llmarena/llmarena |
| **POLLUX** (ai-forever/Sber) | Generative capability in Russian across 35 task types incl. creative writing; 2100 hand-written prompts; ~16 human criteria per instruction; 11 500 responses, 471k human criterion judgements | Human 1.553 · o1 1.534 · Claude 3.5 Sonnet 1.542 · GPT-4o 1.479 · GigaChat-Max 1.464 · YaGPT-4-Pro 1.391. Literary-text subtask: Sonnet 1.413 · GigaChat-Max 1.250 · GPT-4o 1.174 | paper arXiv 2505.24616, **2025** | repo **[verified]** https://github.com/ai-forever/POLLUX ; **the score tables are [snippet-only]** since arxiv and researchgate are blocked. Models tested are all one generation old |
| **simple-evals-ru** (kuk) | Russian vendors on **English** benchmarks (MGSM, MATH, HumanEval, MBPP, BBH, MMLU-Pro, GPQA) + price per 1M tokens. **Says nothing about Russian prose quality** | gigachat-2-max 74.5 · yandexgpt-5-pro 74.8 · t-pro-32b 75.5 · gigachat-2-pro 74.3 vs their prices $19.50 / $12.00 / selfhost / $15.00 | repo, no explicit date on the table | **[verified, fetched]** https://github.com/kuk/simple-evals-ru |
| RussianSuperGLUE / RuCoLA | classical NLU / linguistic acceptability | not retrieved | n/a | rucola-benchmark.com **blocked** |

**Limitations shared by all of them.** MERA and simple-evals-ru measure knowledge and reasoning, not whether the prose sounds like a human Russian wrote it. ru_llm_arena is nearly two years stale. POLLUX is the closest thing to a rigorous human-graded creative-writing evaluation in Russian, but its model list predates everything you would actually deploy. RuQualBench is the only one that measures the thing you care about and is current, and it is a one-person project with an LLM judge whose own README warns of judge variance and recommends running at least three iterations (which is why I averaged three).

---

## Known Russian failure modes in LLM prose

This is the section with the strongest evidence, because the RuQualBench judge prompt is an explicit, Russian-native taxonomy of exactly these failures, and the committed logs contain 16 161 individual judge explanations that I mined.

### The official taxonomy and its severity levels
From `prompts/judge_system_v2.jinja` [verified, fetched raw]: https://raw.githubusercontent.com/kristaller486/RuQualBench/main/prompts/judge_system_v2.jinja

| Error type | Severity in the rubric | Notes |
|---|---|---|
| `incorrect_agreement` (согласование) | **3 = most severe, fixed** | adjectives, participles, numerals with nouns; predicate with subject. Rubric explicitly says agreement must hold **across the whole text**, not just inside one sentence |
| `other_language_insert` | **3, fixed** | "даже самые незначительные вставки на других языках должны считаться ошибками". Real examples in the rubric include stray English and even stray Chinese tokens mid-sentence |
| `syntax` (serious syntactic breakage) | **3, fixed** | |
| `calque` (кальки) | **2, fixed** | established anglicisms ("кейс", "бэкап", "оффер", API/LLM) are explicitly **not** errors; unestablished literal translations are |
| `made_up_words` | **2, fixed** | distorted real words: "глушаешь" for "глушишь", "фаворителей" for "фаворитов", "кражающая" for "крадущая" |
| `wrong_capitalization` | 1 | "Несколько Заглавных Слов Подряд", the English title-case habit leaking into Russian |
| `tautology` | 1 | includes pronoun tautologies. Example given: "Факел в руке дрожит, отбрасывая дрожащие тени" |
| `grammatical_gender_change` | 1 | **the assistant switching its own gender between turns**: "я сделала" then later "я сделал" |

Explicitly **not** errors per the rubric: missing ё, direct-speech formatting, colloquial vocabulary, foreign terms duplicated in parentheses.

### Measured frequency (my own aggregation of 16 161 judge explanations across 32 models × 3 runs)

| Failure family (keyword-classified) | Share of all flagged errors |
|---|---|
| case / agreement (падеж, согласование, склонение) | **20.3 %** |
| **gender (род, мужской/женский)** | **11.5 %** |
| calque / anglicism | 10.6 % |
| tautology / repetition | 10.2 % |
| made-up or distorted word | 9.6 % |
| stylistic / register (стилистика, канцелярит) | 7.2 % |
| foreign-language insert | 6.3 % |
| preposition / government (управление) | 4.6 % |
| syntax / word order | 3.5 % |
| capitalization | 2.5 % |
| punctuation | 1.9 % |
| lexical compatibility / pleonasm | 1.7 % |
| verb aspect (вид глагола) | 0.5 % |
| uncategorized by my regex | 26.5 % |

(Classification is my own keyword heuristic over Russian free-text explanations, so treat the percentages as indicative, not exact. Categories overlap.)

### Your two known bugs, confirmed as industry-wide

**1. Gender of the addressee.** This is a first-class, level-3-adjacent failure, not an edge case. Real judge explanations pulled from the logs:

- Mistral-Nemo: *"Обращение 'дружище' используется в мужском роде, хотя пользователь указал на свой женский пол в запросе ('рада')."* The model got it wrong even when the user's gender was **stated**.
- GPT-OSS-120B: *"Противоречие в использовании грамматического рода при обращении к пользователю: в начале ответа используется существительное мужского рода («мастер»), а в конце — женского («кузнечнице»)."*
- Gemini 2.5 Flash: *"Неправильно определён род персонажа 'Геовани'. В исходном диалоге это мужчина, но в ответе используются местоимения женского рода."*
- Qwen3-235B: *"выползла фигура... Её лицо... В руке он держал"*: gender flips **inside one paragraph**.

Per-model gender-related error rate (my aggregation, errors per 1000 tokens, 3 runs each):

| Best | rate | | Worst | rate |
|---|---|---|---|---|
| Claude Sonnet 4.5 | 0.057 | | Nemotron-Nano-12B | 0.283 |
| DeepSeek V3 | 0.062 | | Mistral-Nemo | 0.269 |
| GPT-4o | 0.072 | | Falcon-H1-34B | 0.255 |
| RuadaptQwen3-32B | 0.075 | | Qwen3-VL-8B | 0.240 |
| **Gemini 2.5 Flash** | **0.075** | | GLM-4.6 | 0.231 |
| Gemma-3-27b-it | 0.076 | | Qwen3-Next-80B | 0.212 |
| GigaChat-20B | 0.084 | | GPT-OSS-120B | 0.202 |
| | | | GPT-5 (low) | 0.165 |
| | | | GPT-5 (minimal) | 0.140 |

**No model is at zero.** Your measured 1-in-3 wrong-gender rate is worse than these numbers imply, but these are per-1000-tokens over mixed tasks; a reading that addresses the user in second person with past-tense verbs concentrates the risk into a handful of high-stakes verb forms. **Conclusion: you cannot prompt this away. Ask the user their gender at onboarding and pass it as a hard field, or constrain the prose to gender-free constructions.** Russian has no gender-neutral first/second-person past tense; the model is being asked to guess, and it guesses.

**2. Formal «вы» leaking despite the prompt.** 118 judge explanations in the logs touch address form. The pattern is **drift**, not a wrong initial choice:

- Gemini 2.5 Flash: *"В тексте присутствует непоследовательность в обращении к читателю: в основной части используется форма 'вы', но в одном месте происходит переход на 'ты' ('Чем дальше ты от центра...')."*
- Gemini 2.5 Flash: *"Несогласованность в обращении к читателю: используется повелительное наклонение 'Оставь' (обращение на 'ты'), в то время как весь остальной текст обращается к читателю на 'вы' ('ваш голос')."*
- GLM-4.6: *"Необоснованный переход с неформального обращения 'ты' на формальное 'вы' ('Обращайтесь', 'вам'), хотя на протяжении всего диалога использовалось 'ты'."*

Frequency of address-form flags is strongly correlated with overall error rate: 0 for Sonnet 4.5 and GPT-4o, 2 for Gemini 2.5 Flash, but 7 for Qwen3-32B, 10 for Qwen3-VL-8B, 16 for MiniMax-M2. **Practical implication: a post-generation regex sweep for `вы|вам|вас|ваш|-ите\b` style forms is cheap and will catch most of it. The prompt alone will not.**

### The other things to watch for in your genre

- **Calques from English, especially in emotive/mystical register.** Judge examples: *"ты в позиции для ответа"* (from "you are in a position to respond"), *"Сегодня прощается"* used where a Russian would say *"На сегодня хватит"*. This is the "перевод с английского" feel: syntactically legal, culturally wrong. Tarot/divination copy translated from English templates is a prime offender.
- **Title Case leaking into Russian.** The rubric flags "Несколько Заглавных Слов Подряд" as an error. If your card names, spread names or section headers are Title Cased the way English does it ("Старший Инженер", "Дрон-Охотник Модель"), Russian readers register it as machine text. Russian capitalizes far less. Note the rubric's carve-out: a common noun elevated to a unique proper name (Кольцо, Вселенная) is legitimate, which covers card names used as proper nouns.
- **Tautology, which the rubric calls out with a literally poetic example**: *"Факел в руке дрожит, отбрасывая дрожащие тени"*. Emotive prose invites exactly this. Also pronoun tautology (он/она/этот/тот repeated).
- **Invented and distorted words**, which spike in high-flourish prose. Log examples: *"несуществующее слово «задержа»"*, *"Выдуманное слово 'КОЛЛЕ'"*, *"'братья-сестры' вместо 'братья и сёстры'"*.
- **Verb aspect (вид)**, rare in count but very visible to natives: *"«коммуникатор вибрировал» вместо «завибрировал» ... требуется совершенный вид, так как действие однократное"*. Divinatory prose is full of single completed future events, exactly where models pick the wrong aspect.
- **Stray non-Cyrillic tokens.** Level 3. Includes English words dropped mid-sentence and, in real logged cases, Chinese characters from Chinese-origin models. **This is a strong argument against Qwen/GLM/MiniMax/Kimi for user-facing Russian.**
- **AI-slop markers specific to Russian**, from a Russian Wikipedia editors' guideline page and Russian editorial press [snippet-only, page blocked]: templated openers of the "Не секрет, что в современном мире…" family, overuse of «является», monotone sentence length and rhythm, over-listing, illogical деепричастные обороты, a colon followed by a capitalized sentence. https://ru.wikipedia.org/wiki/Википедия:Признаки_сгенерированности_текста · https://gramota.ru/journal/stati/tekhnologii/chem-sgenerirovannye-teksty-vydayut-sebya
- **Assistant self-gender flip across turns.** Logged for Gemini 2.5 Flash, Qwen3-235B, RuadaptQwen3, GPT-OSS, GLM-4.6: *"В предыдущем ответе модель использовала женский род ('Рада помочь'), а в текущем - мужской ('Рад')."* If your bot has a persona voice, **fix its gender explicitly in the system prompt** or it will drift between readings.

---

## Russian-native models and OpenRouter

**Short answer: none of them are on OpenRouter.**

Evidence [verified, fetched]: the `models.dev` catalog, which mirrors provider model lists and is current (its OpenRouter/Google folder already contains `gemini-3.7-flash.toml`), lists **61 author namespaces** under OpenRouter: aion-labs, amazon, anthracite-org, anthropic, arcee-ai, baidu, bytedance, cognitivecomputations, cohere, deepseek, dots-studio, google, gryphe, ibm-granite, inception, inclusionai, kwaipilot, liquid, mancer, meituan, meta, meta-llama, microsoft, minimax, mistralai, moonshotai, morph, nex-agi, nousresearch, nvidia, openai, openrouter, perceptron, perplexity, poolside, qwen, rekaai, relace, sakana, sao10k, stepfun, tencent, thedrummer, thinkingmachines, undi95, upstage, writer, x-ai, xiaomi, z-ai and a few aliases. **There is no `gigachat`, `yandex`, `sber`, `vikhr`, `t-tech`, `saiga` or `ruadapt`.**
Source: https://github.com/sst/models.dev/tree/dev/providers/openrouter/models

| Model family | Native? | Where it actually lives | On OpenRouter? | Verdict for you |
|---|---|---|---|---|
| **YandexGPT 5 / Alice AI** (Yandex) | yes | Yandex Cloud API (Russia-centric, international access historically restricted); `YandexGPT-5-Lite-8B` weights published on Hugging Face | **No** | Skip. Also, in RuQualBench the Lite-8B scored 1.03 err/1k, worse than Gemini 2.5 Flash's 0.52. And per simple-evals-ru, Yandex reportedly moved to a **Qwen pretrain** for YandexGPT 5 while charging ~15× the price of Qwen 2.5 32B |
| **GigaChat** (Sber) | yes | Sber's own API; GigaChat 3 open weights on HF under MIT [snippet-only for the licence claim] | **No** | Skip. GigaChat-20B scored 1.57 err/1k in RuQualBench, third-worst tier. Its MERA #1 claim comes from Sber's own press release |
| **T-Pro / T-lite** (T-Bank) | yes | open weights, self-host. simple-evals-ru notes "T Pro и T Lite нет в API" | **No** | Skip unless you self-host. T-pro-it-2.0 scored 1.09 err/1k |
| **Vikhr / Vistral-24B** | yes | Hugging Face weights, self-host | **No** | The one genuinely interesting one: **Vistral-24B tied for 2nd place in RuQualBench (0.51)**, a Russian-adapted fine-tune of Mistral-Small-3.2-24B. But it requires your own GPU. Its base model **is** on OpenRouter and scored 0.68 |
| **Ruadapt (RefalMachine)** | yes | HF weights, self-host | **No** | RuadaptQwen3-32B at 0.74 clearly beats stock Qwen3-32B at 1.26, which is real evidence that Russian adaptation works. Still self-host only |

**What you can actually reach on OpenRouter, with verified prices** (from the same models.dev OpenRouter TOMLs, USD per 1M input / output):

| OpenRouter model | in / out | RuQualBench err/1k |
|---|---|---|
| `google/gemma-3-27b-it` | 0.08 / 0.45 | 0.68 |
| `qwen/qwen3-235b-a22b-2507` | 0.0875 / 0.35 | 0.60 (Vertex run) |
| `deepseek/deepseek-v3.2-exp` | 0.27 / 0.41 | 0.96 |
| `openai/gpt-5-mini` | 0.25 / 2.00 | not measured (GPT-5 was 1.67–2.04) |
| `google/gemini-2.5-flash` | 0.30 / 2.50 | **0.52** |
| `deepseek/deepseek-chat-v3.1` | 0.55 / 1.65 | not measured (V3 was 0.61) |
| `google/gemini-3.1-flash-lite` | 0.25 / 1.50 | not measured |
| `google/gemini-3.7-flash` | 0.75 / 3.75 | not measured |
| `google/gemini-3.5-flash` | 1.50 / 9.00 | not measured |
| `openai/gpt-5.4-mini` | 0.75 / 4.50 | not measured |

---

## Cost, and the Cyrillic tokenization tax

**My own measurement, from the RuQualBench logs.** Across 32 models answering the same 100 Russian prompts, I divided reported completion tokens by word count of the Russian answers:

- **1.8 to 2.5 completion tokens per Russian word**, and **3.1 to 3.7 characters per token**.
- Selected: Mistral-Nemo 1.80 · YandexGPT-5-Lite 1.94 · GPT-4o 2.00 · GPT-5 2.07–2.08 · Gemma-3-27b 2.16 · **Gemini 2.5 Flash 2.17** · Claude Haiku 4.5 2.18 · Mistral-Small-3.2 2.22 · DeepSeek V3.2-Exp 2.25 · **Claude Sonnet 4.5 2.28** · Qwen3-Next 2.30 · Vistral-24B 2.36 · **DeepSeek V3 2.37** · T-pro-it-2.0 2.46.
- Caveat: this is not a strictly controlled parallel-text fertility measurement, because each model writes its own text and providers count tokens slightly differently. It is a good practical estimate of what you will be billed for.

**For your product:** a 600 to 1200 word Russian reading is roughly **1300 to 2900 output tokens**. On `gemini-2.5-flash` at $2.50/1M output that is about **$0.003 to $0.007 per reading** in output cost alone. The same reading in English would cost roughly half.

**Published figures I could not verify directly** [snippet-only, arxiv and the blogs are blocked]:
- "The Tokenizer Tax Across 24/25 European Languages" (arXiv 2605.24718, 2026): English ~1.2 tokens/word; Slavic 2.2–2.5; Ukrainian 2.7 with a 15–18 % penalty over cognate Slavic. Russian therefore ~**1.8× to 2.1× English**, which matches my measurement well. https://arxiv.org/abs/2605.24718
- A per-tokenizer comparison of mean tokens per word for Cyrillic: Llama-4-Maverick 3.5, Llama 3.3 3.6, Gemma 2 3.7, GPT-4o 4.2, DeepSeek 5.4, Qwen3 6.6. **These numbers are much higher than mine and I could not reproduce or verify them; the methodology (probably per-word-in-isolation, not running text) almost certainly differs. Do not plan on them.**
- A cost framing: with GPT-4o input pricing, Russian ~$4.90 per 1M words vs English ~$2.90, a **69 % premium**. https://kathane.substack.com/p/not-speaking-english-to-chatgpt-costs (blocked)
- The earlier "Token Tax: Systematic Bias in Multilingual Tokenization" paper, arXiv 2509.05486 (2025), same theme. https://arxiv.org/abs/2509.05486

**Practical cost/quality note.** Long Russian generation is where the tax bites twice: more tokens **and** models degrade in Russian at long output. The RuQualBench numbers are per-1000-tokens, so a model at 1.5 err/1k will produce roughly 2 to 4 flagged Russian errors in a single 600–1200 word reading, while Gemini 2.5 Flash at 0.52 produces roughly 0.7 to 1.5. That difference is visible to a native reader on every single reading.

---

## محدودیت‌های این تحقیق

**۱) چه چیزهایی اصلاً در دسترس نبود (پروکسی مسدود کرده بود).** با curl و با WebFetch هر دو تست شد و همه ۰۰۰ یا EGRESS_BLOCKED دادند:
reddit.com و old.reddit.com و آینه‌های redlib، habr.com، huggingface.co، arxiv.org، ru.wikipedia.org و en.wikipedia.org، vc.ru، mera.a-ai.ru، llmarena.ru، openrouter.ai، news.ycombinator.com، researchgate.net، aclanthology.org، openreview.net، semanticscholar.org، alphaxiv.org، nature.com، ieeexplore، rucola-benchmark.com، dev.to، medium.com، ollama.com، lmstudio.ai، itweek.ru، technologika.ru، siliconflow، tokencalculator.ai، study24.ai، sostav.ru، gptunnel.ru، models.dev.
**یعنی خواسته‌ی صریحِ مالک، «ببین جامعه‌ها روی ردیت و هابر چه می‌گویند»، عملاً برآورده نشد.** هرچه از ردیت یا هابر در این گزارش هست فقط از خلاصه‌ی موتور جستجوست، نه از خواندنِ خودِ تِرد. من هیچ تِردِ واقعیِ ردیت را ندیدم و به همین دلیل هیچ نقلِ‌قولِ ردیتی در گزارش نیاوردم.

**۲) چند منبع واقعاً باز شد.** فقط **۶ مخزنِ گیت‌هاب** به‌طور کامل خوانده شد (RuQualBench، ru_llm_arena، simple-evals-ru، POLLUX، llmarena، models.dev) به‌علاوه‌ی **۹۶ فایلِ لاگِ JSON و ۲ فایلِ پرامپت و ۱ دیتابیس SQLite** از RuQualBench و چند فایلِ TOML از models.dev. غیرِ این، حدود **۲۵ تا ۳۰ صفحه** فقط از راهِ اسنیپت و خلاصه‌ی موتور جستجو دیده شد. پس نسبتِ «دیده‌ام» به «خوانده‌ام» پایین است و باید در وزن‌دهی لحاظ شود.

**۳) قوی‌ترین بخشِ گزارش، و ضعفش.** جدولِ RuQualBench و آمارِ خطاها را **خودم** از دادهٔ خام ساختم، پس عدد جعلی نیست. ولی: (الف) داور یک LLM است (Gemini 2.5 Pro) و خودِ نویسنده هشدار داده که واریانسِ داور بالاست، برای همین من میانگینِ ۳ ران گرفتم و بازه‌ی min/max را هم آوردم؛ (ب) اینکه داور Gemini است و Gemini 2.5 Flash در رتبه‌ی سوم نشسته، یک **سوگیریِ احتمالیِ هم‌خانوادگی** است که نمی‌توانم ردش کنم؛ (ج) ست فقط ۱۰۰ پرامپت است (lite)؛ (د) لاگ‌ها **اکتبر ۲۰۲۵** اند، یعنی حدود ده ماه قدیمی، و هیچ مدلِ ۲۰۲۶ (Gemini 3.x، GPT-5.4 mini، Claude های جدیدتر) در آن نیست، هرچند مخزن تا ژوئن ۲۰۲۶ فعال بوده و لاگ‌های جدیدتر کامیت نشده‌اند؛ (ه) دسته‌بندیِ درصدیِ انواعِ خطا کارِ خودِ من با regex روی متنِ فارسی‌نشدنیِ روسی است، پس تقریبی است و ۲۶٫۵٪ اصلاً دسته‌بندی نشد.

**۴) ادعاهای تک‌منبع یا تأییدنشده.** این‌ها را به‌عنوان واقعیت به کار نبرید:
- اعدادِ MERA (GigaChat 3.1 Ultra 0.712 در برابر GPT-5.2 0.707، تاریخِ ۲۰ ژوئیه ۲۰۲۶): فقط از اسنیپت، و منبعش **بیانیه‌ی خودِ سبر** است.
- اعدادِ POLLUX: فقط از اسنیپت، خودِ PDF باز نشد.
- اعدادِ مقاله‌ی Tokenizer Tax: فقط از اسنیپت.
- ادعای «۶ تا ۸ درصدِ دادهٔ آموزشی روسی است»: تک‌منبع، صفحه باز نشد.
- ادعای «GigaChat 3 با لایسنسِ MIT اوپن شده»: فقط از اسنیپت.
- جمع‌بندیِ خودِ نویسنده‌ی RuQualBench (Gemma-3-27b و Vistral بی‌رقیب، Qwen3 و GPT-OSS خیلی بد): فقط از اسنیپت، ولی **با محاسبه‌ی مستقلِ من هم‌خوان است**، پس اعتمادپذیرتر از بقیه.
- عنوانِ تِردِ Hacker News («Claude sucks at non English languages»): خودِ صفحه باز نشد و محتوایش را ندیدم؛ ضمناً با دادهٔ RuQualBench در تضاد است.

**۵) جاهایی که شواهد نازک است.**
- **دربارهٔ GPT-5 mini هیچ اندازه‌گیریِ مستقیمی برای روسی پیدا نشد.** آنچه گفتم استنتاج از ردیف‌های GPT-5 است. اگر می‌خواهید GPT-5 mini را رد کنید، بهتر است خودتان یک تستِ کوچک بزنید.
- **دربارهٔ Gemini 3.x Flash / Flash-Lite هیچ سنجشِ کیفیتِ روسی پیدا نشد.** فقط یک نظرِ بلاگیِ متناقض (یکی می‌گوید خوب است ولی گاهی کالک می‌زند، یکی می‌گوید «مثل اسکریپت شده و وردایتی‌اش رفته»). چون شما احتمالاً به همان‌جا مهاجرت می‌کنید، این یک **شکافِ جدیِ دانشی** است.
- **دربارهٔ Mistral** فقط دو نقطه‌ی داده هست: Mistral-Small-3.2-24B خوب (۰٫۶۸) و Mistral-Nemo خیلی بد (۲٫۸۲). یعنی «Mistral» به‌عنوان خانواده حکمِ واحد ندارد.
- **هیچ سنجشی برای «طنینِ عاطفی» یا «حسِ ادبی» پیدا نشد.** RuQualBench فقط **درستیِ زبانی** را می‌شمارد. یک متن می‌تواند صفر خطا داشته باشد و در عین حال خشک و ترجمه‌زده باشد. تنها بنچمارکی که به این نزدیک می‌شود POLLUX است که آن هم قدیمی است و عددش را نتوانستم تأیید کنم. **برای جنسِ محصولِ شما، تنها سنجهٔ معتبر یک A/B با کاربرِ واقعیِ روس‌زبان است.**

**۶) یک نکته‌ی روش‌شناختی.** خلاصه‌ای که موتور جستجو تولید می‌کند خودش خروجیِ یک مدل است و ممکن است اسناد را اشتباه به هم بچسباند. هرجا نوشته‌ام [snippet-only] یعنی دقیقاً همین ریسک وجود دارد و من نتوانستم راستی‌آزمایی کنم.
