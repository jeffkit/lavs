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
  const { id, text } = JSON.parse(input);
  const notes = load();
  const note = notes.find(n => n.id === id);

  if (!note) {
    console.error(JSON.stringify({ error: `Note '${id}' not found` }));
    process.exit(1);
  }

  note.text = text;
  note.updatedAt = new Date().toISOString();
  save(notes);
  console.log(JSON.stringify(note));
});
