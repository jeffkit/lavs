#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'notes.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

let filter = {};
try { if (process.argv[2]) filter = JSON.parse(process.argv[2]); } catch {}

const q = (filter.q || '').toLowerCase();
const notes = load();

const result = q
  ? notes.filter(n => n.text.toLowerCase().includes(q) || (n.category && n.category.toLowerCase().includes(q)))
  : notes;

result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
console.log(JSON.stringify(result));
