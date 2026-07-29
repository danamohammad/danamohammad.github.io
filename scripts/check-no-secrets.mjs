#!/usr/bin/env node
/**
 * Fails the build if anything that looks like a credential is present in the
 * source tree or, more importantly, in the built output. Runs in CI before the
 * Pages artifact is uploaded.
 *
 * The built output matters as much as the source: a token pulled in through a
 * config file or inlined into a script would ship to a public site even though
 * it never appeared in a source file directly.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_DIRS = ['dist', 'src', 'config', 'scripts', 'public'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.astro', 'dist/_astro']);
const TEXT_EXT = new Set([
  '.html', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.astro', '.json',
  '.md', '.css', '.xml', '.txt', '.yml', '.yaml', '.bib', '.svg',
]);

const PATTERNS = [
  { name: 'GitHub token',        re: /\bgh[pousr]_[A-Za-z0-9]{16,}/ },
  { name: 'GitHub PAT (fine)',   re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'AWS access key',      re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key',      re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: 'Slack token',         re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'OpenAI key',          re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic key',       re: /\bsk-ant-[A-Za-z0-9\-_]{20,}/ },
  { name: 'SerpAPI-style key',   re: /\bserpapi[_-]?key["'\s:=]+[A-Za-z0-9]{32,}/i },
  { name: 'Private key block',   re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Bearer literal',      re: /Bearer\s+[A-Za-z0-9\-._~+/]{30,}={0,2}/ },
  {
    name: 'Assigned secret',
    // `api_key = "…"` with a real-looking value. Placeholders are excluded so
    // the documented `YOUR_API_KEY` / `$API_KEY` examples do not trip it.
    re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i,
  },
];

const ALLOW = [
  /YOUR_API_KEY/,
  /process\.env\.API_KEY/,
  /os\.environ\[/,
  /\$API_KEY/,
  /X-API-Key/,
  /PLACEHOLDER/,
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    if (SKIP_DIRS.has(entry) || SKIP_DIRS.has(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(extname(entry)) && st.size < 4_000_000) out.push(full);
  }
  return out;
}

const findings = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const text = readFileSync(file, 'utf8');
    for (const { name, re } of PATTERNS) {
      const m = text.match(re);
      if (!m) continue;

      const line = text.slice(0, m.index).split('\n').length;
      const context = text.split('\n')[line - 1] ?? '';
      if (ALLOW.some((a) => a.test(context))) continue;

      findings.push({ file: relative(ROOT, file), line, name, sample: m[0].slice(0, 12) + '…' });
    }
  }
}

if (findings.length > 0) {
  console.error('SECRET SCAN FAILED\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.name}  (${f.sample})`);
  }
  console.error('\nRemove the value and move it to a GitHub Actions secret.');
  process.exit(1);
}

console.log('Secret scan clean — no credentials in source or built output.');
