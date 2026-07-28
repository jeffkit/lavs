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
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(notes, null, 2));
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const { text, date, category } = JSON.parse(input);
  const notes = load();

  const now = new Date().toISOString();
  const note = {
    id: now.replace(/[-:.TZ]/g, ''),
    text,
    date: date || now.slice(0, 10),
    category: category || null,
    createdAt: now,
    updatedAt: now,
  };

  notes.push(note);
  save(notes);
  console.log(JSON.stringify(note));
});
