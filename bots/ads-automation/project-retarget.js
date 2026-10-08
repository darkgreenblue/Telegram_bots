import { row } from './db.js';
import { projectCapacity, projectSpendCommitment } from './workflow.js';
import { readProductRuntime } from './product-runtime.js';

// Owner-approved identity cutover changes future preparation, never historic tests.
export function retargetUnfundedProject(store, { projectId, confirm }, {
  env = process.env, runtime = readProductRuntime,
} = {}) {
  if (env.ADS_LIVE_ENABLED !== '0' || env.ADS_COST_GATE_VERIFIED !== '0')
    throw new Error('retarget requires both financial gates disabled');
  const db = store.db;
  return db.transaction(() => {
    const p = row(db, 'projects', projectId);
    if (!p || confirm !== p.slug) throw new Error('exact project confirmation required');
    const destination = 'https://t.me/TAROT_PT_BOT', scope = 'tarot-intl@pt';
    if (p.destination === destination && p.scope === scope) return { changed: false };
    if (p.destination !== 'https://t.me/TAROOT_RU_BOT' || p.scope !== 'tarot-intl@en')
      throw new Error('unexpected project origin');
    if (projectCapacity(db, projectId).allocated > 0 || projectSpendCommitment(db, projectId) > 0 ||
        db.prepare('SELECT COUNT(*) n FROM operations').get().n ||
        db.prepare(`SELECT COUNT(*) n FROM experiments WHERE project_id=? AND
          (ad_id IS NOT NULL OR last_spent>0 OR spend_authorized>0 OR status IN ('allocating','winner','limited_winner'))`).get(projectId).n)
      throw new Error('managed financial history prevents retarget');
    const proof = runtime({ ...p, destination, scope });
    if (!proof.verified || !proof.languages?.includes('en')) throw new Error('destination runtime not verified');
    db.prepare('UPDATE projects SET destination=?,scope=? WHERE id=?').run(destination, scope, projectId);
    store.audit('admin-cli', 'project.destination_handover', projectId, {
      previous: { destination: p.destination, scope: p.scope }, current: { destination, scope },
      runtime: { username: proof.username, version: proof.version },
      historicalContextsUnchanged: true, financialAuthorityAdded: false,
    });
    return { changed: true, destination, scope };
  })();
}
