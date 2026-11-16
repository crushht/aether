#!/usr/bin/env node
/**
 * Summarises CSP reports collected in observe mode.
 *
 *   npm run csp:check            print the top violations
 *   npm run csp:check -- --strict   exit 1 when any report exists
 *
 * Enforce the policy (AETHER_CSP_ENFORCE=1) once this is quiet for a few days.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.LAB_DATA_DIR ?? path.join(process.cwd(), '.data');
const file = path.join(dir, 'csp-reports.jsonl');
const strict = process.argv.includes('--strict');

if (!fs.existsSync(file)) {
  console.log(`csp: no reports yet (${file})`);
  process.exit(0);
}

const rows = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

if (!rows.length) {
  console.log('csp: log exists but holds no parsable reports');
  process.exit(0);
}

const counts = new Map();
for (const row of rows) {
  const key = `${row.directive || '(unknown)'} ← ${row.blocked || '(none)'}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

const first = rows[0]?.at ?? '?';
const last = rows[rows.length - 1]?.at ?? '?';
console.log(`csp: ${rows.length} report(s), ${first} → ${last}`);
for (const [key, count] of top) console.log(`  ${String(count).padStart(5)}  ${key}`);

if (strict && rows.length) {
  console.log('\ncsp: reports present — keep observing before enforcing.');
  process.exit(1);
}
