#!/usr/bin/env node
// گارد رفتاریِ پایشِ پاسخ‌گویی داشبورد: سبز بودن pm2 به‌تنهایی معیار سلامت نیست.
import assert from 'node:assert/strict';
import { assessDashboard, checkDashboard, DASHBOARD_SLOW_SEC } from './dashboard-health.mjs';

let pass = 0;
const ok = (condition, label) => {
  assert.ok(condition, label);
  pass++;
  console.log(`  ✅ ${label}`);
};

console.log('▶ سلامت واقعیِ HTTP داشبورد');
ok(assessDashboard({ status: 200, seconds: 0.12 }) === null, 'پاسخ سریع ۲۰۰ سالم است');
ok(assessDashboard({ status: 200, seconds: DASHBOARD_SLOW_SEC }).key === 'dashboard:slow', 'مرز کندی هم هشدار می‌دهد');
ok(assessDashboard({ status: 200, seconds: 3.4 }).key === 'dashboard:slow', 'پاسخ آهسته با وجود ۲۰۰ گرفته می‌شود');
ok(assessDashboard({ status: 524, seconds: 0.1 }).key === 'dashboard:down', 'HTTP نامعتبر خرابی است');
ok(assessDashboard({ status: 0, seconds: 4 }).key === 'dashboard:down', 'timeout بدونِ پاسخ خرابی است');

console.log('\n▶ اجرای واقعیِ probe با runner تزریقی');
const healthy = await checkDashboard(async () => ({ stdout: '200 0.124' }));
ok(healthy.length === 0, 'runner با پاسخ سریع ۲۰۰ هیچ هشدار نمی‌سازد');
const slow = await checkDashboard(async () => ({ stdout: '200 2.001' }));
ok(slow[0]?.key === 'dashboard:slow', 'زمان‌سنجیِ واقعی، کندی را به هشدار تبدیل می‌کند');
const timedOut = await checkDashboard(async () => {
  const e = new Error('timed out');
  e.stdout = '000 4.000';
  throw e;
});
ok(timedOut[0]?.key === 'dashboard:down', 'خطای runner به خرابیِ قابل‌هشدار تبدیل می‌شود');

console.log(`\n✅ ${pass} ادعای پایشِ داشبورد برقرار است`);
