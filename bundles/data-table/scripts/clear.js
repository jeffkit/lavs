#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const dataFile = path.join(process.env.LAVS_PROJECT_PATH || __dirname, '..', 'data', 'table.json');

const table = { columns: [], rows: [], updatedAt: new Date().toISOString() };
fs.writeFileSync(dataFile, JSON.stringify(table, null, 2));
console.log(JSON.stringify({ cleared: true }));
