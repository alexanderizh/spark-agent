const Database = require('better-sqlite3');
const paths = [
  'C:/Users/Administrator/AppData/Roaming/@spark/desktop/spark-dev.db',
  'C:/Users/Administrator/AppData/Roaming/@spark/desktop-dev/spark-dev.db',
  'C:/Users/Administrator/AppData/Roaming/@spark/desktop-dev/spark.db'
];
for (const p of paths) {
  console.log('=== ' + p + ' ===');
  try {
    const db = new Database(p, { readonly: true });
    const agents = db.prepare("SELECT id, name, built_in, is_default FROM agents").all();
    const matches = agents.filter(a => /全栈|全站|fullstack|FullStack/i.test(a.name));
    console.log('Agents matching 全/fullstack: ' + JSON.stringify(matches));
    console.log('All agent names: ' + agents.map(a => a.name).join(' | '));
    const wfs = db.prepare("SELECT id, name, scope FROM workflows").all();
    console.log('Workflows: ' + JSON.stringify(wfs));
    db.close();
  } catch (e) { console.log('  err: ' + e.message); }
}
