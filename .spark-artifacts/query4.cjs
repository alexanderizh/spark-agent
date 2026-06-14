const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('C:/Users/Administrator/AppData/Roaming/@spark/desktop/spark-dev.db', { readonly: true });
const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get('93785cf1-d570-4a2a-8919-108fbf7f39c3');
fs.writeFileSync('G:/spark/spark-agent/.spark-artifacts/agent_only.json', JSON.stringify(agent, null, 2), 'utf8');
const wfsAll = db.prepare("SELECT id, name, scope, version, description, status, tags_json, enabled, length(graph_json) AS gsize FROM workflows").all();
fs.writeFileSync('G:/spark/spark-agent/.spark-artifacts/wfs_summary.json', JSON.stringify(wfsAll, null, 2), 'utf8');
// system scope workflow
const sysWf = db.prepare("SELECT * FROM workflows WHERE name = ? AND scope = 'system'").get('全栈开发标准流程');
fs.writeFileSync('G:/spark/spark-agent/.spark-artifacts/wf_system.json', JSON.stringify(sysWf, null, 2), 'utf8');
const userWf = db.prepare("SELECT * FROM workflows WHERE name = ? AND scope = 'user'").get('全栈开发标准流程');
fs.writeFileSync('G:/spark/spark-agent/.spark-artifacts/wf_user.json', JSON.stringify(userWf, null, 2), 'utf8');
console.log('OK');
db.close();
