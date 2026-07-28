#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'table.json');

function save(table) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(table, null, 2));
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const { columns, rows } = JSON.parse(input);
  const table = {
    columns: columns || [],
    rows: rows || [],
    updatedAt: new Date().toISOString(),
  };
  save(table);
  console.log(JSON.stringify(table));
});
