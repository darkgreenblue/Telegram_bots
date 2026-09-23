// سنجشِ مستقلِ پاسخِ محلیِ داشبورد. `pm2 online` ثابت نمی‌کند حلقه‌ی HTTP واقعاً
// جواب می‌دهد؛ این چک، همان چیزی را می‌سنجد که تونل Cloudflare باید به آن برسد.
export const DASHBOARD_HEALTH_URL = 'http://127.0.0.1:8787/healthz';
export const DASHBOARD_TIMEOUT_MS = 4_000;
export const DASHBOARD_SLOW_SEC = 2;

export function assessDashboard({ status, seconds }) {
  const time = Number(seconds);
  if (Number(status) !== 200) {
    return { key: 'dashboard:down', text: `🔴 داشبورد محلی پاسخ سالم نداد (HTTP ${Number(status) || 0}) — تونل هم نمی‌تواند آن را نمایش دهد.` };
  }
  if (!Number.isFinite(time) || time >= DASHBOARD_SLOW_SEC) {
    const shown = Number.isFinite(time) ? `${time.toFixed(1)} ثانیه` : 'نامشخص';
    return { key: 'dashboard:slow', text: `🟠 داشبورد محلی کند است (${shown}؛ سقف ${DASHBOARD_SLOW_SEC} ثانیه) — خطر timeout بیرونی وجود دارد.` };
  }
  return null;
}

export async function checkDashboard(run) {
  try {
    const { stdout } = await run('curl', [
      '--silent', '--show-error', '--max-time', String(DASHBOARD_TIMEOUT_MS / 1000),
      '--output', '/dev/null', '--write-out', '%{http_code} %{time_total}', DASHBOARD_HEALTH_URL,
    ], { timeout: DASHBOARD_TIMEOUT_MS + 1_000 });
    const [status, seconds] = String(stdout).trim().split(/\s+/);
    const issue = assessDashboard({ status, seconds });
    return issue ? [issue] : [];
  } catch (e) {
    const [status, seconds] = String(e.stdout || '').trim().split(/\s+/);
    return [assessDashboard({ status, seconds }) || {
      key: 'dashboard:down', text: '🔴 داشبورد محلی در مهلت ۴ ثانیه پاسخ نداد — تونل هم نمی‌تواند آن را نمایش دهد.',
    }];
  }
}
