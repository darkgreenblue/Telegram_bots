import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export function openStore(path = process.env.ADS_DB_PATH || './data/ads.db') {
  const file = path === ':memory:' ? ':memory:' : resolve(path);
  if(file!==':memory:')mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      scope TEXT NOT NULL, destination TEXT NOT NULL, market TEXT NOT NULL,
      language TEXT NOT NULL, context TEXT NOT NULL, target_cpa REAL,
      approved_spend REAL NOT NULL DEFAULT 0, max_allocated REAL NOT NULL DEFAULT 20,
      max_campaigns INTEGER NOT NULL DEFAULT 20, mode TEXT NOT NULL DEFAULT 'calibration',
      status TEXT NOT NULL DEFAULT 'draft', created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
      surface TEXT NOT NULL CHECK(surface IN ('channels','bots','search','users')),
      value TEXT NOT NULL, target_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
      hypothesis TEXT NOT NULL, features_json TEXT NOT NULL DEFAULT '{}',
      score REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'found',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(project_id, surface, value, target_json)
    );
    CREATE TABLE IF NOT EXISTS creatives (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
      candidate_id INTEGER REFERENCES candidates(id),
      angle TEXT NOT NULL, ad_text TEXT NOT NULL, banner_text TEXT NOT NULL DEFAULT '',
      image_prompt TEXT NOT NULL DEFAULT '', image_path TEXT, image_sha256 TEXT,
      qa_json TEXT NOT NULL DEFAULT '{}', uploaded_photo_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
      candidate_id INTEGER NOT NULL REFERENCES candidates(id),
      creative_id INTEGER NOT NULL REFERENCES creatives(id),
      tracking_code TEXT UNIQUE, ad_id INTEGER UNIQUE, title TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft', review_status TEXT NOT NULL DEFAULT '',
      cpm REAL NOT NULL, placement TEXT NOT NULL, start_spent REAL NOT NULL DEFAULT 0,
      start_actions INTEGER NOT NULL DEFAULT 0, start_views INTEGER NOT NULL DEFAULT 0,
      last_spent REAL NOT NULL DEFAULT 0, last_remaining REAL NOT NULL DEFAULT 1,
      last_views INTEGER NOT NULL DEFAULT 0,
      last_actions INTEGER NOT NULL DEFAULT 0, first_view_at INTEGER,
      allocated_total REAL NOT NULL DEFAULT 1, returned_total REAL NOT NULL DEFAULT 0,
      activated_at INTEGER, serving_at INTEGER, last_checked_at INTEGER, next_check_at INTEGER,
      test_limit REAL NOT NULL DEFAULT 0.05, test_round INTEGER NOT NULL DEFAULT 1,
      spend_authorized REAL NOT NULL DEFAULT 0,
      test_started_at INTEGER, lease_until INTEGER, stopped_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS exp_due ON experiments(status,next_check_at);
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY, experiment_id INTEGER NOT NULL REFERENCES experiments(id),
      at INTEGER NOT NULL, views INTEGER NOT NULL, actions INTEGER NOT NULL,
      spent REAL NOT NULL, daily_spent REAL, status TEXT NOT NULL, raw_json TEXT NOT NULL,
      UNIQUE(experiment_id,at)
    );
    CREATE TABLE IF NOT EXISTS product_observations (
      id INTEGER PRIMARY KEY,experiment_id INTEGER NOT NULL REFERENCES experiments(id),
      at INTEGER NOT NULL,starts INTEGER NOT NULL,returning_users INTEGER NOT NULL,
      new_users INTEGER NOT NULL,payers INTEGER NOT NULL,revenue REAL NOT NULL,
      revenue_unit TEXT NOT NULL,raw_json TEXT NOT NULL,
      UNIQUE(experiment_id,at)
    );
    CREATE TABLE IF NOT EXISTS rounds (
      experiment_id INTEGER NOT NULL REFERENCES experiments(id), number INTEGER NOT NULL,
      spent REAL NOT NULL, actions INTEGER NOT NULL, views INTEGER NOT NULL,
      reason TEXT NOT NULL, ended_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY(experiment_id,number)
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
      experiment_id INTEGER REFERENCES experiments(id), kind TEXT NOT NULL,
      payload_json TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', message_id INTEGER,
      decided_at INTEGER, allocation_applied INTEGER NOT NULL DEFAULT 0,
      spend_reservation_applied INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
      scope TEXT NOT NULL CHECK(scope IN ('candidate','channel','product')),
      claim TEXT NOT NULL, evidence_json TEXT NOT NULL,
      hypothesis TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'hypothesis',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id),
      kind TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued', lease_owner TEXT, lease_until INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS banner_requests (
      id INTEGER PRIMARY KEY, creative_id INTEGER NOT NULL REFERENCES creatives(id),
      message_id INTEGER UNIQUE, revision INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, text TEXT NOT NULL,
      message_id INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY, op_key TEXT NOT NULL UNIQUE, method TEXT NOT NULL,
      request_json TEXT NOT NULL, response_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, at INTEGER NOT NULL DEFAULT (unixepoch()),
      actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS worker_lease (
      id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, until_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_cooldowns (
      account_key TEXT PRIMARY KEY, until_at INTEGER NOT NULL, reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discovery_runs (
      id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),query TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER,lease_token TEXT,next_at INTEGER NOT NULL DEFAULT 0,response_json TEXT,error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),completed_at INTEGER,
      UNIQUE(project_id,query)
    );
  `);
  if(!db.pragma('table_info(discovery_runs)').some(c=>c.name==='lease_token'))
    db.exec('ALTER TABLE discovery_runs ADD COLUMN lease_token TEXT');
  const experimentColumns=new Set(db.pragma('table_info(experiments)').map(c=>c.name));
  if(!db.pragma('table_info(projects)').some(c=>c.name==='initial_peer_policy'))
    db.exec("ALTER TABLE projects ADD COLUMN initial_peer_policy TEXT NOT NULL DEFAULT 'standard'");
  if(!experimentColumns.has('spend_authorized')){
    db.exec('ALTER TABLE experiments ADD COLUMN spend_authorized REAL NOT NULL DEFAULT 0');
    db.exec(`UPDATE experiments SET spend_authorized=CASE
      WHEN ad_id IS NULL THEN 0
      WHEN status IN ('winner','limited_winner') THEN allocated_total
      ELSE MAX(last_spent,MIN(allocated_total,test_round*test_limit)) END`);
  }
  const decisionColumns=new Set(db.pragma('table_info(decisions)').map(c=>c.name));
  if(!decisionColumns.has('spend_reservation_applied'))
    db.exec('ALTER TABLE decisions ADD COLUMN spend_reservation_applied INTEGER NOT NULL DEFAULT 0');
  const audit = (actor, action, subject, details = {}) => db.prepare(
    'INSERT INTO audit(actor,action,subject,details_json) VALUES (?,?,?,?)'
  ).run(actor, action, String(subject), JSON.stringify(details));
  return { db, audit, close: () => db.close() };
}

export function row(db, table, id) {
  if (!['projects','candidates','creatives','experiments','decisions','jobs','insights'].includes(table)) throw new Error('unknown table');
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
}

export function addCandidate(db, candidate) {
  const {projectId,surface,value,target={},source,evidence=[],hypothesis,features={},score=0} = candidate;
  if (!['channels','bots','search','users'].includes(surface) || !value || !source || !hypothesis) throw new Error('invalid candidate');
  const peer=['channels','bots'].includes(surface);
  if(peer&&!/^@[A-Za-z0-9_]{5,32}$/.test(value))throw new Error('public Telegram username required');
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?
    Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
  const targetJson=JSON.stringify(stable(target)),canonical=peer?value.toLowerCase():value;
  return db.transaction(()=>{
    // Existing IDs may have creatives/tests attached. Preserve them and their
    // measurements when another route rediscovers the same public username.
    const existing=db.prepare(`SELECT * FROM candidates WHERE project_id=? AND surface=?
      AND value ${peer?'COLLATE NOCASE':''}=? ORDER BY id`).all(projectId,surface,canonical)
      .find(c=>JSON.stringify(stable(JSON.parse(c.target_json)))===targetJson);
    if(existing){
      const oldFeatures=JSON.parse(existing.features_json),combined={...oldFeatures,...features};
      for(const key of ['publicPeer','initialReview','publicPeerRetryAt'])
        if(key in oldFeatures)combined[key]=oldFeatures[key];
      const merged=[...new Map([...JSON.parse(existing.evidence_json),...evidence]
        .map(e=>[JSON.stringify(e),e])).values()];
      db.prepare(`UPDATE candidates SET source=?,evidence_json=?,hypothesis=?,features_json=?,score=? WHERE id=?`)
        .run(source,JSON.stringify(merged),hypothesis,JSON.stringify(combined),score,existing.id);
      return existing.id;
    }
    return Number(db.prepare(`INSERT INTO candidates(project_id,surface,value,target_json,source,evidence_json,hypothesis,features_json,score)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(projectId,surface,canonical,targetJson,source,
        JSON.stringify(evidence),hypothesis,JSON.stringify(features),score).lastInsertRowid);
  })();
}

export function addJob(db, projectId, kind, input) {
  return Number(db.prepare('INSERT INTO jobs(project_id,kind,input_json) VALUES (?,?,?)').run(projectId,kind,JSON.stringify(input)).lastInsertRowid);
}

export function leaseJob(db, owner, now = Math.floor(Date.now()/1000)) {
  return db.transaction(() => {
    const job = db.prepare(`SELECT * FROM jobs WHERE status='queued' OR (status='leased' AND lease_until<?)
      ORDER BY id LIMIT 1`).get(now);
    if (!job) return null;
    db.prepare(`UPDATE jobs SET status='leased',lease_owner=?,lease_until=?,attempts=attempts+1 WHERE id=?`).run(owner,now+900,job.id);
    return {...job, input:JSON.parse(job.input_json)};
  })();
}

export function completeJob(db, id, owner, result) {
  const job = row(db,'jobs',id);
  if (!job || job.status!=='leased' || job.lease_owner!==owner || job.lease_until<Math.floor(Date.now()/1000)) throw new Error('job lease expired');
  db.prepare(`UPDATE jobs SET status='done',output_json=?,completed_at=unixepoch(),lease_owner=NULL,lease_until=NULL WHERE id=?`).run(JSON.stringify(result),id);
}
