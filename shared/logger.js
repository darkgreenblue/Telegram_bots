// لاگر مشترک — stdout/stderr که pm2 در ~/.pm2/logs/<app>-{out,error}.log نگه می‌دارد.
// منبع حقیقت دیباگ همین است؛ لاگر دیگری نساز. (CLAUDE.md بند ۸)
export function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
export function log(...a)    { console.log(`[${ts()}]`,   ...a); }
export function logErr(...a) { console.error(`[${ts()}]`, ...a); }
