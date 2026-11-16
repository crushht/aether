#!/usr/bin/env node
/**
 * Finds translation keys used in code that are missing from lib/locales/zh.ts.
 *
 *   node scripts/i18n-check.mjs           report only
 *   node scripts/i18n-check.mjs --strict  exit 1 when keys are missing (CI)
 *
 * Dynamic keys (template literals, computed t(variable)) are skipped on
 * purpose: they cannot be verified statically and would only add noise.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const LOCALE = path.join(root, 'lib', 'locales', 'zh.ts');

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const localeSource = fs.readFileSync(LOCALE, 'utf8');
const known = new Set();
for (const match of localeSource.matchAll(/^\s*'((?:\\.|[^'\\])*)'\s*:/gm)) known.add(match[1]);
for (const match of localeSource.matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*:/gm)) known.add(match[1]);

const used = new Map();
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components')), ...walk(path.join(root, 'lib'))]
  .filter((file) => !file.startsWith(path.join(root, 'lib', 'locales')));

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)) {
    if (!used.has(match[1])) used.set(match[1], file.replace(root + path.sep, ''));
  }
  for (const match of source.matchAll(/\bt\(\s*"((?:\\.|[^"\\])*)"/g)) {
    if (!used.has(match[1])) used.set(match[1], file.replace(root + path.sep, ''));
  }
}

const missing = [...used.entries()].filter(([key]) => !known.has(key));

console.log(`keys: ${known.size} defined, ${used.size} used, ${missing.length} missing`);
for (const [key, file] of missing.slice(0, 60)) console.log(`  missing  ${JSON.stringify(key)}  ${file}`);
if (missing.length > 60) console.log(`  … ${missing.length - 60} more`);

if (strict && missing.length) process.exitCode = 1;

// --hardcoded: string literals holding Chinese that never pass through t().
// Those stay Chinese when the UI is switched to English.
if (process.argv.includes('--hardcoded')) {
  const CJK = /[\u4e00-\u9fff]/;
  const skip = [
    path.join(root, 'lib', 'locales'),
    path.join(root, 'lib', 'mock-data.ts'),
    // data and model-facing payloads stay Chinese on purpose: seeded content,
    // tool receipts handed to the model, and shipped template copy.
    path.join(root, 'lib', 'store', 'data.ts'),
    path.join(root, 'lib', 'agent', 'tools.ts'),
    path.join(root, 'lib', 'agent', 'text.ts'),
    path.join(root, 'lib', 'agent', 'workflow-templates.ts'),
    path.join(root, 'lib', 'agent', 'types.ts'),
    path.join(root, 'lib', 'people.ts'),
    path.join(root, 'lib', 'session.ts'),
    // outgoing mail is bilingual content, not a UI string: a code mail reads
    // the same whatever language the browser is in
    path.join(root, 'lib', 'email-rules.ts'),
    path.join(root, 'lib', 'server', 'accounts.ts'),
    path.join(root, 'lib', 'i18n.ts'),
    path.join(root, 'scripts'),
  ];
  const found = [];
  for (const file of files) {
    if (skip.some((prefix) => file.startsWith(prefix))) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('i18n-allow')) return;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const withoutComments = line.replace(/\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');
      for (const match of withoutComments.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g)) {
        const literal = match[1] ?? match[2] ?? match[3] ?? '';
        if (!CJK.test(literal)) continue;
        if (literal.length > 200) continue;
        found.push(`${file.replace(root + path.sep, '')}:${index + 1}  ${literal.slice(0, 70)}`);
      }
    });
  }
  console.log(`\nhardcoded Chinese literals: ${found.length}`);
  for (const line of found.slice(0, 80)) console.log(`  ${line}`);
  if (found.length > 80) console.log(`  … ${found.length - 80} more`);
  if (strict && found.length) process.exitCode = 1;
}
