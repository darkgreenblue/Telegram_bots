// memory.js — حافظه‌ی منشی درباره‌ی مالک: فقط شناختِ ماندگار (حساسیت‌ها، اولویت‌ها، حال‌وهوا)،
// نه فهرست کارها (کارها در تیک‌تیک/تقویم مکتوب می‌شوند). یک فراخوانی ارزانِ flash، سقف ۱۲۰۰ کاراکتر.
// fail-safe: خطای این تابع هرگز نباید فلوی اصلی را بشکند (فقط logErr).
import { logErr } from '../../shared/logger.js';

const CAP = 1200;

export async function updateMemory(or, db, uid, observations) {
  try {
    if (!observations || !observations.length) return;
    const cur = db.prepare('SELECT memory_json FROM users WHERE telegram_id=?').get(uid)?.memory_json || '';
    const sys = [
      'تو حافظه‌ی یک منشی شخصی را نگه می‌داری. حافظه‌ی فعلی و چند مشاهده‌ی تازه درباره‌ی صاحبت می‌گیری،',
      'و نسخه‌ی به‌روزِ حافظه را برمی‌گردانی.',
      'فقط شناختِ ماندگار و به‌دردبخور نگه دار: حساسیت‌ها، چه چیزی برایش مهم‌تر است، چه چیزی خوشحال یا عصبانی‌اش می‌کند، سلیقه‌های کاری.',
      'هرگز کارها، جلسه‌ها یا یادداشت‌های یک‌بارمصرف را در حافظه نگذار.',
      'موارد تکراری را ادغام کن، چیزهای کهنه یا کم‌ارزش را حذف کن، و کل متن را زیر ۱۲۰۰ کاراکتر نگه دار.',
      'خروجی فقط خودِ متنِ حافظه به فارسی باشد (بدون توضیح، بدون نقل‌قول دور کل متن).',
      'از خط تیره‌ی بلند «—» یا دوتایی «--» استفاده نکن.',
    ].join('\n');
    const user = `حافظه‌ی فعلی:\n${cur || '(خالی)'}\n\nمشاهده‌های تازه:\n- ${observations.join('\n- ')}`;
    const res = await or.chatResilient(sys, user, { maxTokens: 600, temperature: 0.3 });
    if (!res || !res.out.trim()) return;
    const merged = res.out.trim().slice(0, CAP);
    db.prepare('UPDATE users SET memory_json=? WHERE telegram_id=?').run(merged, uid);
  } catch (e) {
    logErr('memory update:', e.message);
  }
}
