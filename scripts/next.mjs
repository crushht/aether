// The queue driver: print the next unfinished item from NEXT.md, or tick one off.
// Only the `## 待办` section counts — "阻塞" holds items that need outside assets.
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
const blockIndex = args.indexOf('--block');

/** Move an item out of the rotating queue without claiming it is done. */
function blockItem(target) {
  const line = `- [ ] ${target}`;
  if (!text.includes(line)) {
    console.error(`not found: ${target}`);
    process.exit(1);
  }
  text = text.replace(`${line}\n`, '');
  const header = '## 阻塞（需要外部资产，不进入轮转队列）';
  const note = `${line}（自动标记：一轮未产出改动）`;
  text = text.includes(header) ? text.replace(header, `${header}\n\n${note}`) : `${text}\n${header}\n\n${note}\n`;
  writeFileSync(file, text, 'utf8');
  console.log(`blocked: ${target}`);
}

/** Unchecked items inside `## 待办` only. */
function pendingItems(source) {
  const items = [];
  let inQueue = false;
  for (const line of source.split('\n')) {
    if (/^##\s/.test(line)) {
      inQueue = /^##\s*待办/.test(line);
      continue;
    }
    if (!inQueue) continue;
    const match = /^- \[ \] (.+)$/.exec(line.trim());
    if (match) items.push(match[1]);
  }
  return items;
}

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

if (blockIndex >= 0) {
  const target = (args[blockIndex + 1] ?? '').trim();
  if (!target) {
    console.error('usage: node scripts/next.mjs --block "<item text>"');
    process.exit(1);
  }
  blockItem(target);
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

const items = pendingItems(text);
const next = items[0];

if (!next) {
  console.log('ALL_DONE');
  process.exit(2);
}

console.log(next);
console.error(`(${items.length} remaining)`);
