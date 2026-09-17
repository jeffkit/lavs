// Tiny JSON-file store shared by the endpoint scripts.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'data', 'items.json');

function read() {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}
function write(items) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
}
module.exports = { read, write };
