#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'notes.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}
function save(notes) {
  fs.writeFileSync(dataFile, JSON.stringify(notes, null, 2));
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const { id } = JSON.parse(input);
  const notes = load();
  const next = notes.filter(n => n.id !== id);
  save(next);
  console.log(JSON.stringify({ deleted: next.length < notes.length }));
});
