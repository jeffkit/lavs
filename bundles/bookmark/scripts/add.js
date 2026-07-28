#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'bookmarks.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return []; }
}
function save(b) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(b, null, 2));
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const { url, title, description, tags } = JSON.parse(input);
  const bookmarks = load();

  // Derive title from URL host if not provided
  let derivedTitle = title;
  if (!derivedTitle) {
    try { derivedTitle = new URL(url).hostname.replace(/^www\./, ''); }
    catch { derivedTitle = url; }
  }

  const bookmark = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url,
    title: derivedTitle,
    description: description || '',
    tags: tags || [],
    createdAt: new Date().toISOString(),
  };

  bookmarks.push(bookmark);
  save(bookmarks);
  console.log(JSON.stringify(bookmark));
});
