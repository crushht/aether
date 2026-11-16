// The loop driver: print the next unfinished item from NEXT.md, or tick one off.
//   node scripts/next.mjs
//   node scripts/next.mjs --done "Issue List 首屏骨架"
//   node scripts/next.mjs --add "some new item"
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../NEXT.md', import.meta.url));
let text = readFileSync(file, 'utf8');

const args = process.argv.slice(2);
const doneIndex = args.indexOf('--done');
const addIndex = args.indexOf('--add');

if (doneIndex >= 0) {
  const target = (args[doneIndex + 1] ?? '').trim();
  if (!target) {
    console.error('usage: node scripts/next.mjs --done "<item text>"');
    process.exit(1);
  }
  const before = text;
  text = text.replace(new RegExp(`^- \\[ \\] ${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'), `- [x] ${target}`);
  if (text === before) {
    console.error(`not found: ${target}`);
    process.exit(1);
  }
  writeFileSync(file, text, 'utf8');
  console.log(`done: ${target}`);
  process.exit(0);
}

if (addIndex >= 0) {
  const item = (args[addIndex + 1] ?? '').trim();
  if (!item) {
    console.error('usage: node scripts/next.mjs --add "<item text>"');
    process.exit(1);
  }
  text = text.replace(/^(## 待办\s*\n)/m, `$1\n- [ ] ${item}\n`);
  writeFileSync(file, text, 'utf8');
  console.log(`added: ${item}`);
  process.exit(0);
}

const head = text.split('## 已完成')[0];
const next = head
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line.startsWith('- [ ]'));

if (!next) {
  console.log('ALL_DONE');
  process.exit(2);
}

console.log(next.replace(/^- \[ \]\s*/, ''));

const remaining = head.split('\n').filter((line) => line.trim().startsWith('- [ ]')).length;
console.error(`(${remaining} remaining)`);
