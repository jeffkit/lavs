#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'bookmarks.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}

let filter = {};
try { if (process.argv[2]) filter = JSON.parse(process.argv[2]); } catch {}

const bookmarks = load();
const result = filter.tag
  ? bookmarks.filter(b => (b.tags || []).includes(filter.tag))
  : bookmarks;

// Sort: newest first
result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
console.log(JSON.stringify(result));
