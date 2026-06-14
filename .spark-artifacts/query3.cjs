const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('C:/Users/Administrator/AppData/Roaming/@spark/desktop/spark-dev.db', { readonly: true });
const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get('93785cf1-d570-4a2a-8919-108fbf7f39c3');
const wfs = db.prepare("SELECT * FROM workflows WHERE name = ?").all('全栈开发标准流程');
fs.writeFileSync('G:/spark/spark-agent/.spark-artifacts/agent_workflow_export.json', JSON.stringify({ agent, workflows: wfs }, null, 2), 'utf8');
console.log('OK');
db.close();
