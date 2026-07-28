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

const todos = load();
const next = todos.filter(t => !t.done);
const deleted = todos.length - next.length;
save(next);

console.log(JSON.stringify({ deleted }));
