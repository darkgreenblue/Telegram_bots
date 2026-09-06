import { readFileSync } from 'fs';
import Database from '../bots/tarot/node_modules/better-sqlite3/lib/index.js';
const SRC = readFileSync('bots/tarot/index.js', 'utf8');

// بدنه‌ی یک bot.action را با شمارشِ آکولاد از سورس می‌بُرد (بدونِ کپیِ محلی)
function actionBody(marker) {
  const i = SRC.indexOf(marker);
  if (i < 0) throw new Error('not found: ' + marker);
  const s0 = SRC.indexOf('{', SRC.indexOf('=>', i));
  let d = 0;
  for (let j = s0; j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s0 + 1, j); }
  }
}
const navBody    = actionBody("bot.action('nav:menu'");
const cancelBody = actionBody('bot.action(/^pay_cancel:(\\d+)$/');
const PAY_STATES = JSON.parse((SRC.match(/const PAY_STATES = (\[[^\]]+\])/)[1]).replace(/'/g,'"'));

const db = new Database(':memory:');
db.exec(`CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
  amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  step TEXT DEFAULT 'amount', updated_at INTEGER NOT NULL DEFAULT 0);`);
const UID = 6149194760;
const getPayment = { get: (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id) };
const setPaymentStatus = { run: (s, id) => db.prepare('UPDATE payments SET status=? WHERE id=?').run(s, id) };
const openPaymentRow = () => ({ id: Number(db.prepare('INSERT INTO payments (user_id) VALUES (?)').run(UID).lastInsertRowid), fresh: true });

const world = { state: 'pay_amount', session: {} };
world.session.paymentId = openPaymentRow().id;   // کاربر سرِ صفحه‌ی بسته‌ها

const deps = {
  getSession: () => JSON.parse(JSON.stringify(world.session)),
  setSession: (_u, v) => { world.session = v || {}; },
  setState:   (_u, v) => { world.state = v; },
  patchSession: (_u, patch) => { Object.assign(world.session, patch); return world.session; },
  stmts: { getPayment, setPaymentStatus, setKbShown: { run(){} } },
  PAY_STATES, coinsOn: () => true, openPaymentRow, starsRail: false,
  packMenuScreen: () => ['صفحه‌ی بسته‌ها', {}],
  walletScreen: () => ['کیف', {}],
  cancelReading: () => 0, blockDuringDelivering: async () => false, blockDuringOpenLucky: async () => false,
  replyCanceled: async () => {}, offerPendingReading: async () => {}, expose(){}, db, STARS_EXPERIMENT: 'x',
  L: { errors: { openInvoice: 'یه فاکتور شارژِ باز داری' }, buttons: { cancel: 'انصراف' }, reading: { backToMenu: 'منو' } },
  Markup: { inlineKeyboard: (r) => ({ reply_markup: r }), button: { callback: (t, d) => ({ t, d }) } },
};
const replies = [];
const mkCtx = (matchPid) => ({
  from: { id: UID }, chat: { id: UID }, match: [null, String(matchPid ?? '')],
  callbackQuery: { message: { message_id: 1 } },
  answerCbQuery: async () => {}, editMessageReplyMarkup: async () => {}, deleteMessage: async () => {},
  editMessageText: async () => { throw new Error('no'); },
  telegram: { deleteMessage: async () => {}, editMessageText: async () => { throw new Error('no'); } },
  reply: async (t, extra) => { replies.push({ t, extra }); return { message_id: 2 }; },
});
const run = (body, ctx) => new Function('ctx','d', `
  const {getSession,setSession,setState,patchSession,stmts,PAY_STATES,coinsOn,openPaymentRow,starsRail,
    packMenuScreen,walletScreen,cancelReading,blockDuringDelivering,blockDuringOpenLucky,replyCanceled,
    offerPendingReading,expose,db,STARS_EXPERIMENT,L,Markup}=d;
  return (async()=>{${body}})();`)(ctx, deps);

console.log('شروع:', JSON.stringify(world));
for (let i = 1; i <= 4; i++) {
  replies.length = 0;
  await run(navBody, mkCtx());                       // کاربر «بازگشت به منو» می‌زند
  const guard = replies.find(r => r.t === 'یه فاکتور شارژِ باز داری');
  if (!guard) { console.log(`دورِ ${i}: گارد نیامد → کاربر آزاد شد.`); break; }
  const btn = guard.extra.reply_markup[0][0].d;
  console.log(`دورِ ${i}: گارد آمد؛ دکمه‌ی انصراف → «${btn}»`);
  await run(cancelBody, mkCtx(btn.split(':')[1]));   // کاربر «انصراف» را می‌زند
  console.log(`        بعد از انصراف: state=${world.state}  paymentId=${world.session.paymentId}`);
}
console.log('\nردیف‌های پرداخت:', db.prepare('SELECT id,status,amount FROM payments').all());
