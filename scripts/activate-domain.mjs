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
// Domain is configurable so the same guard works for whichever hostname
// becomes canonical. Defaults to the Cloudflare-managed domain Dana owns.
const args = process.argv.slice(2).filter((a) => a !== '--apply');
const DOMAIN = args[0] ?? 'dana-edu.pp.ua';
const TARGET = 'danamohammad.github.io';
const APPLY = process.argv.includes('--apply');

console.log(`Checking ${DOMAIN}…\n`);

// A DNS lookup alone proves nothing here. is-a.dev wildcards *every* name under
// the zone to Cloudflare, so an unregistered subdomain resolves to the same A
// records as a registered one and answers with a 302 to is-a.dev/available.
// Verified against a control name that certainly is not registered.
// The real test is what the hostname actually serves.
const cname = await dns.resolveCname(DOMAIN).catch(() => null);
const a = await dns.resolve4(DOMAIN).catch(() => null);
console.log(`  CNAME  -> ${cname?.length ? cname.join(', ') : '(none)'}`);
console.log(`  A      -> ${a?.length ? a.join(', ') : '(none)'}`);

const res = await fetch(`https://${DOMAIN}/`, { redirect: 'manual' }).catch(() => null);
if (!res) {
  console.error(`\n  ${DOMAIN} did not respond. Nothing changed.`);
  process.exit(1);
}

const location = res.headers.get('location') ?? '';
console.log(`  HTTP   -> ${res.status}${location ? ` -> ${location}` : ''}`);

if (/is-a\.dev\/available/.test(location)) {
  console.error(
    `\n  NOT REGISTERED YET.\n\n` +
      `  ${DOMAIN} still redirects to the is-a.dev "available" page, which means\n` +
      `  the pull request has not merged. Writing public/CNAME now would point\n` +
      `  GitHub Pages at a hostname that does not serve this site, taking\n` +
      `  https://${TARGET} down until it was reverted.\n\n` +
      `  Nothing changed.`
  );
  process.exit(1);
}

// Follow through and confirm the hostname really serves this site.
const body = await fetch(`https://${DOMAIN}/`, { redirect: 'follow' })
  .then((r) => r.text())
  .catch(() => '');

if (!body.includes('Dana Mohammad Khidhir')) {
  console.error(
    `\n  ${DOMAIN} resolves but is not serving this site yet.\n` +
      `  This is normal for a short window after the PR merges while GitHub\n` +
      `  issues the certificate. Try again shortly. Nothing changed.`
  );
  process.exit(1);
}

console.log('  content-> serving this site');

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
const robots = readFileSync(robotsPath, 'utf8');
writeFileSync(robotsPath, robots.replace(/^Sitemap: .*$/m, `Sitemap: https://${DOMAIN}/sitemap-index.xml`));
console.log('  updated robots.txt sitemap URL');

console.log(
  `\nNext:\n` +
    `  1. npm run check\n` +
    `  2. git add -A && git commit -m "Switch to ${DOMAIN}" && git push\n` +
    `  3. Enable "Enforce HTTPS" in Settings > Pages once the certificate provisions.\n\n` +
    `https://${TARGET} keeps working and redirects to the custom domain.`
);
