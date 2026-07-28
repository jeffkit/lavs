#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'notes.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

const notes = load();

// Optional date filter from first arg
let filter = {};
try { if (process.argv[2]) filter = JSON.parse(process.argv[2]); } catch {}

const result = filter.date
  ? notes.filter(n => n.date === filter.date)
  : notes;

// Sort: newest first (by createdAt desc)
result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

console.log(JSON.stringify(result));
