#!/usr/bin/env node
// 🛟 چکِ مقاومتِ افشای فالِ پول‌داده در برابرِ قطعیِ شبکه (v3.114.0) — **رفتاری**.
//
// تیکتِ #TRT-1902690343: کاربر وسطِ تحویلِ جوابِ نهایی `read ECONNRESET` خورد، قفلِ
// `finalDone` یتیم ماند، و از آن لحظه هر ورودی (دکمه‌ی منو، `/start`، `/menu`، حتی دکمه‌ی
// پشتیبانی) همان گاردِ «ادامه بدی یا بی‌خیالش بشی؟» را برمی‌گرداند که دکمه‌اش هیچ کاری
// نمی‌کرد. پنج شکافِ هم‌خانواده که این فایل نگهبانشان است:
//   ۱) `revealNext` قفلِ `revealIdx` را قبل از ارسال جلو می‌برد و هرگز پس نمی‌گرفت: شکستِ
//      ارسال یعنی کارتی که کاربر **هرگز** نمی‌بیند.
//   ۲) `readings.reveal_idx` هم قبل از ارسال مهر می‌خورد، پس `/start` هم از روی کارت می‌پرید.
//   ۳) خطای وسطِ افشا به `bot.catch` می‌رسید و فقط پیامِ عمومی می‌داد؛ دکمه‌ی قبلی هم پیش‌تر
//      برداشته شده بود، یعنی هیچ راهی به بقیه‌ی فال نمی‌ماند.
//   ۴) `/start` در استیتِ افشا گارد می‌خورد به‌جای بازسازی از DB، پس سشنِ خراب راهِ فرار نداشت.
//   ۵) دکمه‌ی «💬 پشتیبانی» پشتِ گاردِ مرکزی می‌ماند (خلافِ بند ۶ج ریشه).
//
// روش: خودِ کدِ `index.js` بریده و **اجرا** می‌شود (نه کپیِ منطق). شناسه‌هایش از یک scopeِ
// استاب با `with` + Proxy تأمین می‌شوند؛ هر شناسه‌ای که استاب نشده باشد ReferenceError می‌دهد،
// پس تغییرِ امضای کد بی‌صدا از چک رد نمی‌شود.
import { readFileSync, readdirSync } from 'fs';

const SRC = readFileSync(new URL('../bots/tarot/index.js', import.meta.url), 'utf8');
let pass = 0; const errs = [];
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { errs.push(m); console.log(`  ❌ ${m}`); } };

/** از `start` (اولین `{` بعدش) تا آکولادِ متناظر. */
function block(from) {
  const i = SRC.indexOf(from);
  if (i < 0) throw new Error(`«${from}» در index.js پیدا نشد`);
  const b = SRC.indexOf('{', i);
  let d = 0;
  for (let j = b; j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}' && --d === 0) return SRC.slice(i, j + 1);
  }
  throw new Error(`پایانِ «${from}» پیدا نشد`);
}
/** یک تابع/arrow از سورس، با شناسه‌های آزادِ تأمین‌شده از `scope`. */
function load(src, scope) {
  const f = new Function('__s', `with (__s) { return (${src}); }`);
  return f(new Proxy(scope, { has: (t, k) => typeof k === 'string' && k in t }));
}
const Markup = {
  button: { callback: (t, d) => ({ t, d }) },
  inlineKeyboard: (rows) => ({ kb: rows }),
};

/* ═══════════════ ۱) revealNext: شکستِ ارسال کارت را جا نمی‌اندازد ═══════════════ */
console.log('\n── ۱) revealNext: رول‌بکِ قفل و مهرِ DB فقط بعد از ارسالِ موفق ──');
{
  const SRC_RN = block('async function revealNext(ctx, uid, readingId)');
  const RID = 7, U = 42;
  const mk = ({ v4 = true, failPhoto = false, failReply = 0, advanceTo = null, fbDone = true } = {}) => {
    const S = { session: { readingId: RID, revealIdx: 0, fbDone }, state: 'revealing', dbIdx: [], replies: [], finished: 0 };
    let nReply = 0;
    const ctx = {
      reply: async (text, extra) => {
        nReply++;
        if (failReply && nReply === failReply) throw new Error('read ECONNRESET');
        S.replies.push({ text, extra });
        return { message_id: nReply };
      },
    };
    const fn = load(SRC_RN, {
      stmts: {
        getReading: { get: () => ({ id: RID, type: 't3', llm_json: JSON.stringify({ cards: [{ teaser: 'T0', text: 'X0' }, { teaser: 'T1', text: 'X1' }, { teaser: 'T2', text: 'X2' }], confirmation_question: 'CQ' }), cards_json: JSON.stringify([{ key: 'a' }, { key: 'b' }, { key: 'c' }]) }) },
        setRevealIdx: { run: (...a) => { S.dbIdx.push(a); } },
      },
      SPREAD_BY_ID: { t3: { positions: [{ fa: 'p' }, { fa: 'p' }, { fa: 'p' }] } },
      getSession: () => ({ ...S.session }),
      patchSession: (_u, p) => { Object.assign(S.session, p); },
      getState: () => S.state,
      setState: (_u, st) => { S.state = st; },
      v4For: () => v4,
      locCard: () => ({}),
      finishReading: async () => { S.finished++; },
      typing: async () => {},
      sendCardPhoto: async () => {
        if (advanceTo !== null) S.session.revealIdx = advanceTo;   // پیشرفتِ واقعیِ دیگری وسطِ کار
        if (failPhoto) throw new Error('read ECONNRESET');
      },
      L: { reading: { revealCaptionV4: () => 'cap', revealCaption: () => 'cap' }, prompts: { cardLabels: () => ['a', 'b', 'c'] },
        buttons: { nextCard: 'NEXT', finalAnswer: 'FINAL', fbYes: 'y', fbSomewhat: 's', fbNo: 'n' } },
      positionName: () => 'p', esc: (x) => x, Markup, sleep: async () => {},
      PACE_S: 0, PACE_M: 0, PACE_TEASER: 0,
    });
    return { S, run: (idx = 0) => { S.session.revealIdx = idx; return fn(ctx, U, RID); } };
  };

  // مسیرِ موفق
  { const t = mk(); await t.run(0);
    ok(t.S.session.revealIdx === 1, 'ارسالِ موفق: قفلِ سشن یک قدم جلو می‌رود');
    ok(t.S.dbIdx.length === 1 && t.S.dbIdx[0][0] === 1 && t.S.dbIdx[0][1] === RID, 'ارسالِ موفق: reveal_idx روی خودِ فال مهر می‌خورد');
    ok(t.S.replies.some(r => JSON.stringify(r.extra).includes(`next:${RID}:1`)), 'دکمه‌ی کارتِ بعد شماره‌ی درست را حمل می‌کند'); }

  // شکستِ عکس
  { const t = mk({ failPhoto: true }); let threw = false;
    try { await t.run(0); } catch { threw = true; }
    ok(threw, 'شکستِ ارسال دوباره پرتاب می‌شود تا صداکننده (bot.catch) دکمه‌ی ادامه بدهد');
    ok(t.S.session.revealIdx === 0, 'شکستِ عکسِ کارت: قفل پس گرفته می‌شود، پس همان کارت دوباره می‌آید');
    ok(t.S.dbIdx.length === 0, 'شکستِ عکسِ کارت: reveal_idx مهر **نمی‌خورد** (یعنی «کاربر دیده»، نه «قصد داشتیم»)'); }

  // شکستِ تیزر بعد از رسیدنِ عکس
  { const t = mk({ failReply: 1 }); try { await t.run(1); } catch {}
    ok(t.S.session.revealIdx === 1 && t.S.dbIdx.length === 0, 'شکستِ تیزر (عکس رفته، متن نه): همان کارت دوباره، بدونِ مهرِ DB'); }

  // خطای دیرهنگام نباید پیشرفتِ واقعیِ بعدی را عقب ببرد
  { const t = mk({ failPhoto: true, advanceTo: 5 }); try { await t.run(0); } catch {}
    ok(t.S.session.revealIdx === 5, 'رول‌بک فقط وقتی است که هنوز خودمان جلو برده‌ایم (پیشرفتِ دیگری عقب نمی‌رود)'); }

  // نسلِ قدیم: شکستِ سؤالِ بازخورد، استیتِ feedback را هم برمی‌گرداند
  { const t = mk({ v4: false, fbDone: false, failReply: 2 }); try { await t.run(1); } catch {}
    ok(t.S.session.revealIdx === 1 && t.S.state === 'revealing',
      'شکستِ سؤالِ بازخوردِ میانه: قفل و استیت هر دو برمی‌گردند (وگرنه next: در feedback گیر می‌کند)'); }

  // مهرِ DB بعد از ارسال‌هاست، نه قبلشان (ساختاری، مکملِ ادعاهای رفتاری)
  const iStamp = SRC_RN.indexOf('stmts.setRevealIdx.run'), iCatch = SRC_RN.indexOf('} catch (e) {');
  ok(iStamp > 0 && iCatch > 0 && iStamp > iCatch, 'setRevealIdx بیرون و بعد از بلوکِ ارسال نشسته است');
}

/* ═══════════════ ۲) final: شکستِ تحویلِ جواب ═══════════════ */
console.log('\n── ۲) final: قفلِ یتیم باز می‌شود، و فالِ تحویل‌شده گاردِ مرده نمی‌گیرد ──');
{
  const hSrc = block('bot.action(/^final:(\\d+)$/, async (ctx) =>');
  const arrow = hSrc.slice(hSrc.indexOf('async (ctx) =>'));
  const RID = 9, U = 42;
  const mk = ({ session, finish }) => {
    const S = { session: { readingId: RID, ...session }, status: 'started', replies: [], cb: [], finishCalls: 0 };
    const fn = load(arrow, {
      getSession: () => ({ ...S.session }),
      patchSession: (_u, p) => { Object.assign(S.session, p); },
      stmts: { getReading: { get: () => ({ id: RID, user_id: U, status: S.status }) } },
      FINAL_DELIVERY_LOCK_S: 45,
      finishReading: async () => { S.finishCalls++; await finish(S); },
      logErr: () => {}, L: { reading: { deliverGuard: 'DG', openReadingGuard: 'OG' }, buttons: { finalAnswer: 'FINAL' } }, Markup,
    });
    const ctx = {
      from: { id: U }, match: [null, String(RID)],
      answerCbQuery: async (t) => { S.cb.push(t); },
      editMessageReplyMarkup: async () => {},
      reply: async (text, extra) => { S.replies.push({ text, extra }); },
    };
    return { S, go: () => fn(ctx) };
  };
  const net = () => { throw new Error('read ECONNRESET'); };

  { const t = mk({ session: {}, finish: async () => net() }); await t.go();
    ok(t.S.session.finalDone === false && t.S.session.finalAttemptAt === 0, 'قطعیِ وسطِ جواب: قفل باز می‌شود');
    ok(t.S.replies.length === 1 && t.S.replies[0].text === 'DG', 'و گاردِ بی‌انصراف (deliverGuard) می‌آید، نه «ادامه یا بی‌خیال»');
    ok(JSON.stringify(t.S.replies[0].extra).includes(`final:${RID}`), 'با همان دکمه‌ی جوابِ نهایی'); }

  { const t = mk({ session: {}, finish: async (S) => { S.status = 'delivered'; net(); } }); await t.go();
    ok(t.S.replies.length === 0, 'خطا از دُمِ finishReading (جواب رسیده): هیچ گارد و دکمه‌ی مرده‌ای نمی‌رود'); }

  { const t = mk({ session: { finalDone: true }, finish: async () => {} }); await t.go();
    ok(t.S.finishCalls === 1, 'قفلِ نسخه‌ی قدیم (بدونِ مهرِ زمان) یتیم حساب می‌شود و تحویل دوباره تلاش می‌شود'); }

  { const now = Math.floor(Date.now() / 1000);
    const t = mk({ session: { finalDone: true, finalAttemptAt: now }, finish: async () => {} }); await t.go();
    ok(t.S.finishCalls === 0 && t.S.cb.includes('⌛️'), 'تپِ دوم وسطِ یک تحویلِ زنده همچنان بی‌اثر است (ضدِ دوبار)'); }
}

/* ═══════════════ ۳) bot.catch وسطِ افشا ═══════════════ */
console.log('\n── ۳) bot.catch: خطای وسطِ افشا دکمه‌ی ادامه می‌دهد، نه بن‌بست ──');
{
  const cSrc = block('bot.catch(async (err, ctx) =>');
  const arrow = cSrc.slice(cSrc.indexOf('async (err, ctx) =>'));
  const mk = (state, row, { rowThrows = false } = {}) => {
    const S = { replies: [] };
    const fn = load(arrow, {
      logErr: () => {}, getState: () => state,
      revealResumeRow: () => { if (rowThrows) throw new Error('db'); return row; },
      L: { reading: { deliverGuard: 'DG' }, errors: { generic: 'GEN' } }, Markup,
    });
    const ctx = { updateType: 'callback_query', from: { id: 1 }, reply: async (text, extra) => { S.replies.push({ text, extra }); } };
    return { S, go: () => fn(new Error('read ECONNRESET'), ctx) };
  };
  { const t = mk('revealing', [{ t: 'NEXT', d: 'next:5:2' }]); await t.go();
    ok(t.S.replies.length === 1 && t.S.replies[0].text === 'DG' && JSON.stringify(t.S.replies[0].extra).includes('next:5:2'),
      'افشا + ردیفِ ادامه: فقط گارد با همان دکمه (بدونِ پیامِ عمومیِ اضافه)'); }
  { const t = mk('revealing', null); await t.go();
    ok(t.S.replies.length === 1 && t.S.replies[0].text === 'GEN', 'افشا ولی چیزی برای ادامه نیست: پیامِ عمومیِ همیشگی'); }
  { const t = mk('idle', [{ t: 'x', d: 'y' }]); await t.go();
    ok(t.S.replies.length === 1 && t.S.replies[0].text === 'GEN', 'بیرونِ افشا رفتار دقیقاً همان قبلی است'); }
  { const t = mk('revealing', null, { rowThrows: true }); await t.go();
    ok(t.S.replies.length === 1 && t.S.replies[0].text === 'GEN', 'اگر خودِ بازیابی خطا داد، کاربر باز هم بی‌جواب نمی‌ماند'); }
}

/* ═══════════════ ۴) دکمه‌ی پشتیبانی هرگز گارد نمی‌شود ═══════════════ */
console.log('\n── ۴) «💬 پشتیبانی» از گاردِ مرکزی رد می‌شود (بند ۶ج ریشه) ──');
{
  const LOCS = {};
  for (const f of readdirSync(new URL('../bots/tarot/locales/', import.meta.url))) {
    if (!/^[a-z]{2}\.js$/.test(f)) continue;
    LOCS[f.slice(0, 2)] = (await import(new URL(`../bots/tarot/locales/${f}`, import.meta.url))).default;
  }
  const allLabels = (pick) => Object.values(LOCS).map(l => { try { return pick(l); } catch { return undefined; } });
  const supports = allLabels(l => l.support?.button).filter(Boolean);
  const readings = allLabels(l => l.buttons.reading).filter(Boolean);
  ok(supports.length >= 5, `برچسبِ پشتیبانیِ هر ${supports.length} زبان پیدا شد`);
  const i0 = SRC.indexOf('const SUPPORT_LABELS'), i1 = SRC.indexOf('registerJourney(bot, {');
  ok(i0 > 0 && i1 > i0, 'SUPPORT_LABELS و FLOW_SWITCH_TEXTS پیش از ثبتِ جرنی تعریف شده‌اند');
  const snippet = SRC.slice(i0, i1);
  const KB_LABELS = new Set([...supports, ...readings, 'x']);
  const FLOW = new Function('allLabels', 'KB_LABELS', `${snippet}; return FLOW_SWITCH_TEXTS;`)(allLabels, KB_LABELS);
  ok(supports.every(s => !FLOW.has(s)), 'هیچ برچسبِ پشتیبانی (در هیچ زبانی) در FLOW_SWITCH_TEXTS نیست');
  ok(readings.every(r => FLOW.has(r)) && FLOW.has('/menu'), 'کنترلِ مثبت: دکمه‌های منو و /menu هنوز گارد می‌شوند');
  const kbDecl = SRC.slice(SRC.indexOf('const KB_LABELS = new Set(['), SRC.indexOf('const SUPPORT_LABELS'));
  ok(/allLabels\(l => l\.support\?\.button\)/.test(kbDecl), 'KB_LABELS همچنان پشتیبانی را دارد (جرنی آن را «دکمه» می‌شمارد)');
}

/* ═══════════════ ۵) /start وسطِ افشا بازسازی می‌کند، گارد نمی‌کند ═══════════════ */
console.log('\n── ۵) /start: سشنِ افشا از DB از نو ساخته می‌شود (راهِ فرارِ همیشگی) ──');
{
  const hsSrc = block('async function handleStart(ctx)');
  const U = 42;
  const mk = ({ state = 'revealing', unready = false, payBlock = false, readBlock = false, row = [{ t: 'FINAL', d: 'final:9' }] } = {}) => {
    const S = { state, calls: [], replies: [], sessions: [] };
    const rec = (name, ret) => async (...a) => { S.calls.push(name); return typeof ret === 'function' ? ret(...a) : ret; };
    const fn = load(hsSrc, {
      upsertUser: () => ({ isNew: false }), getUser: () => ({ welcomed: 1, last_daily_date: 'today' }),
      captureStart: () => {}, db: {}, PRODUCT_VERSION: 'x',
      stmts: { insertReferral: { run() {} }, setReferredBy: { run() {} }, lastDelivered: { all: () => [] }, setKbShown: { run() {} } },
      MULTI_LANG: false, showLangPicker: rec('showLangPicker'), needsGate: () => false, track: () => {},
      GATE_CHANNEL_NOW: () => '', showGate: rec('showGate'), startOnboarding: rec('startOnboarding'),
      INTENT: { MENU: 'menu' },
      blockDuringOpenPay: rec('blockDuringOpenPay', payBlock),
      getState: () => S.state,
      resolveUnreadyReveal: rec('resolveUnreadyReveal', unready),
      blockDuringOpenReading: rec('blockDuringOpenReading', readBlock),
      blockDuringPendingReading: rec('blockDuringPendingReading', false),
      blockDuringDelivering: rec('blockDuringDelivering', true),
      resumeAwaitingQuestionFromDb: () => null,
      logErr: () => {}, Markup,
      setState: (_u, st) => { S.state = st; S.calls.push(`setState:${st}`); },
      setSession: (_u, v) => { S.sessions.push(v); S.calls.push('setSession'); },
      uxV2For: () => true, dispName: () => 'N', getBalance: () => 0, curOf: () => ({}), botToday: () => 'today',
      L: { returning: { greetingV2: () => 'HI', greeting: () => 'HI', dailyReminder: '', milestoneHook: () => '' },
        reading: { deliverGuard: 'DG', openReadingGuard: 'OG' }, buttons: { resumeReading: 'R', cancel: 'C' } },
      mainKeyboard: () => ({ main: true }),
      resumeRowFromDb: () => { S.calls.push('resumeRowFromDb'); return row; },
      sendStartMenu: rec('sendStartMenu'),
    });
    const ctx = { from: { id: U }, message: { text: '/start' }, startPayload: '', reply: async (text, extra) => { S.replies.push({ text, extra }); } };
    return { S, go: () => fn(ctx) };
  };

  { const t = mk(); await t.go();
    ok(!t.S.calls.includes('blockDuringDelivering') && !t.S.calls.includes('blockDuringOpenReading'),
      'افشا: /start گارد نمی‌خورد (گاردِ بی‌انصراف راهِ فرار نیست)');
    const iReset = t.S.calls.indexOf('setSession'), iRow = t.S.calls.indexOf('resumeRowFromDb');
    ok(iReset >= 0 && iRow > iReset, 'اول سشنِ خراب پاک می‌شود، بعد از reveal_idxِ DB بازسازی');
    ok(t.S.replies[0]?.text === 'HI' && t.S.replies[0]?.extra?.main, 'خوش‌آمد با کیبوردِ ماندگار (کاربر هرگز بی‌منو نمی‌ماند)');
    ok(t.S.replies[1]?.text === 'DG' && JSON.stringify(t.S.replies[1].extra).includes('final:9'), 'و بعد پیشنهادِ ادامه با گاردِ بی‌انصراف');
    ok(!t.S.calls.includes('sendStartMenu'), 'فالِ نیمه‌تحویل بر منو مقدم است'); }

  { const t = mk({ unready: true }); await t.go();
    ok(t.S.calls.includes('resolveUnreadyReveal') && t.S.replies.length === 0 && !t.S.calls.includes('setSession'),
      'افشا بدونِ خروجیِ مدل: همان مسیرِ ریفاند/انتظار، بدونِ ریستِ سشن'); }

  { const t = mk({ state: 'await_question', readBlock: true }); await t.go();
    ok(t.S.calls.includes('blockDuringOpenReading') && t.S.replies.length === 0,
      'کنترلِ مثبت: وسطِ ورودِ سؤال، /start هنوز گاردِ ادامه/انصراف را می‌دهد'); }

  { const t = mk({ payBlock: true }); await t.go();
    ok(t.S.calls[0] === 'blockDuringOpenPay' && t.S.calls.length === 1, 'فاکتورِ باز حتی وسطِ افشا بر همه‌چیز مقدم است (گاردِ پول)'); }
}

/* ═══════════════ ۶) گاردِ افشا انصراف را وعده نمی‌دهد ═══════════════ */
console.log('\n── ۶) متنِ گاردِ افشا ──');
{
  // کامنت‌ها قبل از سنجش حذف می‌شوند (تله‌ی ثبت‌شده‌ی چندباره: کامنتِ توضیحی یک ادعای سالم را قرمز می‌کند).
  const bd = block('async function blockDuringDelivering(ctx)').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok(/L\.reading\.deliverGuard/.test(bd) && !/openReadingGuard/.test(bd), 'blockDuringDelivering متنِ بی‌انصرافِ خودش را می‌دهد');
  ok(!/reading:cancel|rcancel:/.test(bd), 'و هیچ دکمه‌ی لغوی نمی‌سازد');
  for (const f of readdirSync(new URL('../bots/tarot/locales/', import.meta.url))) {
    if (!/^[a-z]{2}\.js$/.test(f)) continue;
    const L = (await import(new URL(`../bots/tarot/locales/${f}`, import.meta.url))).default;
    const g = L.reading?.deliverGuard;
    ok(typeof g === 'string' && g.length > 10 && !/—|--/.test(g), `${f}: deliverGuard هست و خط تیره‌ی بلند ندارد`);
    ok(g !== L.reading?.openReadingGuard, `${f}: متنش با گاردِ «ادامه یا بی‌خیال» یکی نیست`);
  }
}

console.log(`\n${errs.length ? '❌' : '✅'} نتیجه: ${pass} پاس، ${errs.length} خطا`);
if (errs.length) { errs.forEach(e => console.log(`   - ${e}`)); process.exit(1); }
