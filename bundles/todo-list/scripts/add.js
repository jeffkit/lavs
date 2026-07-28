#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataDir  = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data');
const dataFile = path.join(dataDir, 'todos.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

function save(data) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

let input = {};
try {
  const raw = fs.readFileSync(0, 'utf8'); // stdin
  if (raw.trim()) input = JSON.parse(raw);
} catch {}

if (!input.text || typeof input.text !== 'string') {
  process.stderr.write('Error: "text" is required\n');
  process.exit(1);
}

const todos = load();
const newTodo = {
  id:        Date.now(),
  text:      input.text.trim(),
  done:      false,
  priority:  input.priority || 2,
  tags:      Array.isArray(input.tags) ? input.tags : [],
  createdAt: new Date().toISOString(),
};

todos.push(newTodo);
save(todos);

console.log(JSON.stringify(newTodo));
