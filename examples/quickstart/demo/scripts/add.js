const { read, write } = require('./store');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const { text } = JSON.parse(input || '{}');
  const items = read();
  if (text && !items.includes(text)) items.push(text);
  write(items);
  process.stdout.write(JSON.stringify({ ok: true, count: items.length }));
});
