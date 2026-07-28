#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'bookmarks.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

const bookmarks = load();
const counts = {};
for (const b of bookmarks) {
  for (const t of (b.tags || [])) {
    counts[t] = (counts[t] || 0) + 1;
  }
}

const result = Object.entries(counts)
  .map(([tag, count]) => ({ tag, count }))
  .sort((a, b) => b.count - a.count);

console.log(JSON.stringify(result));
