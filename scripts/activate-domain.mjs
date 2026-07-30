#!/usr/bin/env node
/**
 * Switches the site over to the custom domain — run this ONLY after the
 * is-a.dev pull request has merged and the DNS record has propagated.
 *
 * Order matters. Committing public/CNAME before DNS resolves makes GitHub Pages
 * redirect the .github.io address to a hostname that does not exist yet, which
 * takes the live site down until propagation catches up. So this script refuses
 * to run until it has confirmed the record actually resolves.
 *
 *   node scripts/activate-domain.mjs            # check only
 *   node scripts/activate-domain.mjs --apply    # check, then write the changes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as dns } from 'node:dns';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN = 'danakhidhir.is-a.dev';
const TARGET = 'danamohammad.github.io';
const APPLY = process.argv.includes('--apply');

console.log(`Checking ${DOMAIN}…\n`);

let resolves = false;
try {
  const cname = await dns.resolveCname(DOMAIN).catch(() => null);
  if (cname?.length) {
    console.log(`  CNAME -> ${cname.join(', ')}`);
    resolves = cname.some((c) => c.replace(/\.$/, '') === TARGET);
  }
  if (!resolves) {
    const a = await dns.resolve4(DOMAIN).catch(() => null);
    if (a?.length) {
      console.log(`  A     -> ${a.join(', ')}`);
      resolves = true;
    }
  }
} catch {
  /* handled below */
}

if (!resolves) {
  console.error(
    `  ${DOMAIN} does not resolve yet.\n\n` +
      `  The is-a.dev PR has probably not merged, or DNS has not propagated.\n` +
      `  Nothing changed. The site stays live at https://${TARGET}.`
  );
  process.exit(1);
}

const res = await fetch(`https://${DOMAIN}`, { redirect: 'manual' }).catch(() => null);
console.log(`  HTTPS  -> ${res ? res.status : 'no response yet (certificate may still be issuing)'}`);

if (!APPLY) {
  console.log('\nResolves correctly. Re-run with --apply to switch the site over.');
  process.exit(0);
}

writeFileSync(join(ROOT, 'public/CNAME'), DOMAIN + '\n');
console.log('\n  wrote public/CNAME');

const cfgPath = join(ROOT, 'config/site.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.site.customDomain = `https://${DOMAIN}`;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`  set site.customDomain = https://${DOMAIN}`);

const robotsPath = join(ROOT, 'public/robots.txt');
writeFileSync(
  robotsPath,
  readFileSync(robotsPath, 'utf8').replace(`https://${TARGET}`, `https://${DOMAIN}`)
);
console.log('  updated robots.txt sitemap URL');

console.log(
  `\nNext:\n` +
    `  1. npm run check\n` +
    `  2. git add -A && git commit -m "Switch to danakhidhir.is-a.dev" && git push\n` +
    `  3. Enable "Enforce HTTPS" in Settings > Pages once the certificate provisions.\n\n` +
    `https://${TARGET} keeps working and redirects to the custom domain.`
);
