#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'todos.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

const todos = load();

// Optional filter from first arg
let filter = {};
try { if (process.argv[2]) filter = JSON.parse(process.argv[2]); } catch {}

const result = typeof filter.done === 'boolean'
  ? todos.filter(t => t.done === filter.done)
  : todos;

// Sort: undone first, then by priority (1=high first), then by createdAt desc
result.sort((a, b) => {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const pa = a.priority || 2;
  const pb = b.priority || 2;
  if (pa !== pb) return pa - pb;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
});

console.log(JSON.stringify(result));
