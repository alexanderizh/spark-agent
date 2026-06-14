const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Copy user's dev DB
const srcDb = 'C:/Users/Administrator/AppData/Roaming/@spark/desktop/spark-dev.db';
const tmpDb = 'G:/spark/spark-agent/.spark-artifacts/test-existing.db';
try { fs.unlinkSync(tmpDb); } catch(e) {}
try { fs.unlinkSync(tmpDb + '-shm'); } catch(e) {}
try { fs.unlinkSync(tmpDb + '-wal'); } catch(e) {}
fs.copyFileSync(srcDb, tmpDb);

const db = new Database(tmpDb);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Inspect before
console.log('BEFORE:');
const beforeAgent = db.prepare("SELECT id, name, built_in, workflow_id, length(prompt) AS plen FROM agents WHERE id = ?").get('93785cf1-d570-4a2a-8919-108fbf7f39c3');
console.log('Agent: ' + JSON.stringify(beforeAgent));
const beforeWf = db.prepare("SELECT id, name, scope, status, length(graph_json) AS gsize FROM workflows WHERE id = ?").get('f67ac8d8-d89b-4ec3-9ef4-2fe8d4f8fa4c');
console.log('Workflow: ' + JSON.stringify(beforeWf));

// Apply only 028
const sql = fs.readFileSync('G:/spark/spark-agent/packages/storage/migrations/028_builtin_fullstack_coding_agent.sql', 'utf8');
const tx = db.transaction(() => { db.exec(sql); });
tx();

// Inspect after
console.log('\nAFTER:');
const afterAgent = db.prepare("SELECT id, name, built_in, workflow_id, length(prompt) AS plen, metadata_json FROM agents WHERE id = ?").get('93785cf1-d570-4a2a-8919-108fbf7f39c3');
console.log('Agent: ' + JSON.stringify(afterAgent));
const afterWf = db.prepare("SELECT id, name, scope, status, enabled, length(graph_json) AS gsize FROM workflows WHERE id = ?").get('f67ac8d8-d89b-4ec3-9ef4-2fe8d4f8fa4c');
console.log('Workflow: ' + JSON.stringify(afterWf));

// Re-run idempotency
const tx2 = db.transaction(() => { db.exec(sql); });
tx2();
console.log('\nIDEMPOTENT re-run OK');
const cnt1 = db.prepare("SELECT COUNT(*) AS c FROM agents WHERE id = ?").get('93785cf1-d570-4a2a-8919-108fbf7f39c3').c;
const cnt2 = db.prepare("SELECT COUNT(*) AS c FROM workflows WHERE id = ?").get('f67ac8d8-d89b-4ec3-9ef4-2fe8d4f8fa4c').c;
console.log('Agent count: ' + cnt1 + ', Workflow count: ' + cnt2);

db.close();
