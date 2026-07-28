#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'table.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return { columns: [], rows: [] }; }
}
function save(table) {
  fs.writeFileSync(dataFile, JSON.stringify(table, null, 2));
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const { rows } = JSON.parse(input);
  const table = load();
  table.rows = table.rows.concat(rows || []);
  // Union any new columns from incoming rows
  const colSet = new Set(table.columns || []);
  for (const r of (rows || [])) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  table.columns = [...colSet];
  table.updatedAt = new Date().toISOString();
  save(table);
  console.log(JSON.stringify(table));
});
