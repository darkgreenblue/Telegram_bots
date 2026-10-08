import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// Presentation language must not select another bot's wallet/history database.
export function storageProfile(env = process.env) {
  const locale = env.LOCALE?.trim() || 'fa';
  const storage = env.STORAGE_LOCALE?.trim() || locale;
  if (!['fa', 'en', 'ru', 'es', 'pt'].includes(locale) ||
      !['fa', 'en', 'ru', 'es', 'pt'].includes(storage)) throw new Error('invalid storage profile');
  if (storage !== locale && !(locale === 'en' && storage === 'pt' &&
      env.LANGS === 'en,es,ru,pt')) throw new Error('unsupported storage handover');
  return { locale, storage, handover: storage !== locale,
    expectedUsername: storage !== locale ? 'TAROT_PT_BOT' : null };
}

export async function verifyStorageIdentity(profile, token, { fetcher = fetch } = {}) {
  if (!profile.handover) return null;
  let me;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(`https://api.telegram.org/bot${token}/getMe`, {
        method: 'POST', signal: AbortSignal.timeout(15000),
      });
      const body = await response.json();
      if (!body.ok) {
        const error = new Error('bot identity unavailable');
        error.terminal = response.status < 500;
        throw error;
      }
      me = body.result; break;
    } catch (error) {
      if (error.terminal || attempt === 2) throw new Error('storage identity verification failed');
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  if (me?.username?.toLowerCase() !== profile.expectedUsername.toLowerCase())
    throw new Error('storage bot identity mismatch');
  return me;
}

// Only existing Portuguese users with no language receive their original language.
// No wallets, states, sessions, payments, message IDs or media caches are copied.
export async function retainStorageLanguage(db, profile, { directory = './data', log = () => {} } = {}) {
  if (!profile.handover) return { applied: false };
  db.exec(`CREATE TABLE IF NOT EXISTS storage_profile_migrations (
    key TEXT PRIMARY KEY, at INTEGER NOT NULL DEFAULT (unixepoch()),
    changed_users INTEGER NOT NULL, backup TEXT NOT NULL
  )`);
  const key = 'portuguese-unified-v1';
  if (db.prepare('SELECT key FROM storage_profile_migrations WHERE key=?').get(key))
    return { applied: false };
  const openReadings = db.prepare("SELECT COUNT(*) n FROM readings WHERE status NOT IN ('delivered','refunded','canceled','failed')").get().n;
  const openPayments = db.prepare("SELECT COUNT(*) n FROM payments WHERE status NOT IN ('approved','reversed','canceled','failed','refunded')").get().n;
  const queued = db.prepare('SELECT COUNT(*) n FROM admin_actions WHERE done_at IS NULL').get().n;
  if (openReadings || openPayments || queued) throw new Error('storage handover requires drained operations');
  const folder = join(directory, 'handover'); mkdirSync(folder, { recursive: true, mode: 0o700 });
  const backup = join(folder, `bot-pt-before-unified-${Date.now()}.db`);
  await db.backup(backup);
  chmodSync(backup, 0o600);
  const changedUsers = db.transaction(() => {
    const changed = db.prepare("UPDATE users SET lang='pt' WHERE lang IS NULL OR lang=''").run().changes;
    db.prepare('INSERT INTO storage_profile_migrations(key,changed_users,backup) VALUES (?,?,?)')
      .run(key, changed, backup);
    return changed;
  })();
  log(JSON.stringify({ event: 'storage.handover.language_retained', storage: 'pt', changedUsers }));
  return { applied: true, changedUsers, backup };
}
