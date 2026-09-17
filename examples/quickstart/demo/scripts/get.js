const { read } = require('./store');
process.stdout.write(JSON.stringify(read()));
