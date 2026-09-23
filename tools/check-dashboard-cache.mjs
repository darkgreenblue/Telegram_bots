#!/usr/bin/env node
// گارد قراردادِ cache: URLهای معادل باید یک نتیجه بخوانند و نوشتن atomic قابل‌خواندن باشد.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = mkdtempSync(join(tmpdir(), 'dashboard-cache-'));
process.env.DASH_CACHE_DIR = sandbox;
const { canonicalDashUrl, canonicalAnalyticsUrl, dashCacheKey, readDashCache, writeDashCache } = await import('../bots/dashboard/lib/dash-cache.js');
const { notAdminReadings } = await import('../bots/dashboard/lib/engage.js');

let pass = 0;
const ok = (condition, label) => { assert.ok(condition, label); pass++; console.log(`  ✅ ${label}`); };

try {
  console.log('▶ کلید و بازیابی cache داشبورد');
  const plain = '/dash?bot=tarot';
  const noisy = '/dash?bot=tarot&range=week&aw=99&g=unexpected&ignored=x';
  ok(canonicalDashUrl(plain) === '/dash?bot=tarot&range=week&aw=7&g=inc', 'فیلترهای پیش‌فرض canonical می‌شوند');
  ok(dashCacheKey(plain) === dashCacheKey('/dash?g=inc&aw=7&range=week&bot=tarot'), 'ترتیب پارامترها cache را دوپاره نمی‌کند');
  ok(canonicalDashUrl(noisy) === '/dash?bot=tarot&range=week&aw=7&g=inc', 'ورودی نامعتبر به مقدار امن برمی‌گردد');
  ok(readDashCache(plain) === null, 'cache خالی null است');
  writeDashCache(plain, '<p>ready</p>', 1234);
  const found = readDashCache('/dash?range=week&g=inc&bot=tarot&aw=7');
  ok(found?.body === '<p>ready</p>' && found.createdAt === 1234, 'نسخهٔ نوشته‌شده با URL معادل خوانده می‌شود');

  console.log('\n▶ استقلالِ بخش‌ها و صحتِ داده');
  ok(canonicalAnalyticsUrl('/engagement?msg=done&bot=tarot&window=7') === '/engagement?bot=tarot&window=7', 'پیام موقت cache بخش تحلیلی را تکثیر نمی‌کند');
  ok(notAdminReadings(true, [42, 42, 'x']).includes('NOT IN (42)'), 'فیلتر ادمینِ ازپیش‌خوانده‌شده فقط شناسهٔ عددی می‌پذیرد');
  ok(notAdminReadings(true, []).length === 0, 'نبود ادمین بدون اسکنِ دوباره همان نتیجهٔ صحیح را می‌دهد');
  const index = readFileSync(new URL('../bots/dashboard/index.js', import.meta.url), 'utf8');
  ok(index.includes("'/dash': (url) => ['آمار تحلیلی', cachedAnalyticsBody(url)]"), 'گزارش اصلی از مسیرِ cache می‌آید');
  ok(index.includes("'/support': (url) => ['پشتیبانی', supportBody(url)]") && index.includes("'/users': (url) => ['کاربران', usersBody(url)]"), 'پشتیبانی و عملیات کاربر مستقیم و مستقل مانده‌اند');
  console.log(`\n✅ ${pass} قراردادِ cache برقرار است`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
