#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'bookmarks.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}
function save(b) {
  fs.writeFileSync(dataFile, JSON.stringify(b, null, 2));
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const { id } = JSON.parse(input);
  const bookmarks = load();
  const next = bookmarks.filter(b => b.id !== id);
  save(next);
  console.log(JSON.stringify({ deleted: next.length < bookmarks.length }));
});
