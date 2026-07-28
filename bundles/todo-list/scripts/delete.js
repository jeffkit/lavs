#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'todos.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

function save(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

let input = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw.trim()) input = JSON.parse(raw);
} catch {}

if (!input.id) { process.stderr.write('Error: "id" is required\n'); process.exit(1); }

const todos = load();
const next = todos.filter(t => t.id !== input.id);
const deleted = todos.length !== next.length;
if (deleted) save(next);

console.log(JSON.stringify({ deleted }));
