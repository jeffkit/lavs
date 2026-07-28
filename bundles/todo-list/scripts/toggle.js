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
const idx = todos.findIndex(t => t.id === input.id);
if (idx === -1) { process.stderr.write(`Error: todo ${input.id} not found\n`); process.exit(1); }

const newDone = typeof input.done === 'boolean' ? input.done : !todos[idx].done;
todos[idx] = { ...todos[idx], done: newDone };
save(todos);

console.log(JSON.stringify(todos[idx]));
