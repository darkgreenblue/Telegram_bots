import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

// Read-only preflight and consistent snapshots BEFORE retiring the source poller.
const root = resolve(process.argv[2] || 'bots/tarot');
const require = createRequire(join(root, 'index.js'));
const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const env = dotenv.parse(readFileSync(join(root, '.env.pt')));
const { storageProfile, verifyStorageIdentity } = await import('../bots/tarot/storage-profile.js');
const profile = storageProfile(env);
if (!profile.handover) throw new Error('destination handover config missing');
await verifyStorageIdentity(profile, env.BOT_TOKEN);
const directory = join(root, 'data', 'handover');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const marker = join(directory, 'source-archived-v1.json');
if (existsSync(marker)) { console.log(JSON.stringify({ event: 'handover.preflight.replay' })); process.exit(0); }
const stores = [];
try {
  for (const locale of ['en', 'pt']) {
    const db = new Database(join(root, 'data', `bot-${locale}.db`), { readonly: true, fileMustExist: true });
    stores.push(db);
    const openReadings = db.prepare("SELECT COUNT(*) n FROM readings WHERE status NOT IN ('delivered','refunded','canceled','failed')").get().n;
    const openPayments = db.prepare("SELECT COUNT(*) n FROM payments WHERE status NOT IN ('approved','reversed','canceled','failed','refunded')").get().n;
    const queued = db.prepare('SELECT COUNT(*) n FROM admin_actions WHERE done_at IS NULL').get().n;
    if (openReadings || openPayments || queued) throw new Error(`handover.${locale}.operations_not_drained`);
  }
  const snapshots = [];
  for (let i = 0; i < stores.length; i++) {
    const locale = ['en', 'pt'][i];
    const path = join(directory, `bot-${locale}-before-handover-${Date.now()}.db`);
    await stores[i].backup(path); chmodSync(path, 0o600);
    snapshots.push({ locale, path, users: stores[i].prepare('SELECT COUNT(*) n FROM users').get().n });
  }
  writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), snapshots,
    policy: 'Portuguese history stays active; Russian/unified history stays separate; no financial merge.' }), { mode: 0o600 });
  console.log(JSON.stringify({ event: 'handover.preflight.archived', snapshots: snapshots.map(({ locale, users }) => ({ locale, users })) }));
} catch (error) {
  console.error(JSON.stringify({ event: 'handover.preflight.failed', reason: error.message })); process.exitCode = 1;
} finally { for (const db of stores) db.close(); }
