const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const tmpDb = 'G:/spark/spark-agent/.spark-artifacts/test-migration.db';
try { fs.unlinkSync(tmpDb); } catch(e) {}
try { fs.unlinkSync(tmpDb + '-shm'); } catch(e) {}
try { fs.unlinkSync(tmpDb + '-wal'); } catch(e) {}

const db = new Database(tmpDb);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);

const migDir = 'G:/spark/spark-agent/packages/storage/migrations';
const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
for (const f of files) {
  const version = parseInt(f.match(/^(\d+)/)[1], 10);
  const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
  try {
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, f);
    });
    tx();
    console.log('OK ' + f);
  } catch (e) {
    console.log('FAIL ' + f + ': ' + e.message);
    db.close();
    process.exit(1);
  }
}

const agent = db.prepare("SELECT id, name, built_in, enabled, workflow_id, length(prompt) AS prompt_len FROM agents WHERE id = ?").get('93785cf1-d570-4a2a-8919-108fbf7f39c3');
console.log('AGENT: ' + JSON.stringify(agent));
const wf = db.prepare("SELECT id, name, scope, status, enabled, length(graph_json) AS gsize FROM workflows WHERE id = ?").get('f67ac8d8-d89b-4ec3-9ef4-2fe8d4f8fa4c');
console.log('WORKFLOW: ' + JSON.stringify(wf));
const allAgents = db.prepare("SELECT id, name, built_in FROM agents ORDER BY name").all();
console.log('ALL AGENTS: ' + JSON.stringify(allAgents));
const allWfs = db.prepare("SELECT id, name, scope, status FROM workflows ORDER BY name").all();
console.log('ALL WORKFLOWS: ' + JSON.stringify(allWfs));
db.close();
