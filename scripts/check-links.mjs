#!/usr/bin/env node
/**
 * Link checker for the built site.
 *
 *   - Internal links must resolve to a file in dist/. A broken internal link
 *     always fails the run.
 *   - External links are probed with HEAD, falling back to GET. Only genuine
 *     "gone" responses fail; bot-blocking and rate limiting do not.
 *
 * Publishers actively fight crawlers, and a link checker that treats that as a
 * broken link produces noise instead of signal. Verified examples: doi.org
 * redirects to MDPI, which answers 403 to any non-browser client, and
 * sciencedirect answers 403 the same way. Those links are fine in a browser.
 *
 * Usage:  node scripts/check-links.mjs [--external]
 * External checking is opt-in so the default run stays fast and offline.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CHECK_EXTERNAL = process.argv.includes('--external');

// Statuses that mean "the checker was blocked", not "the page is missing".
const BLOCKED = new Set([401, 403, 405, 406, 418, 429, 503]);

// Links known to be unreachable for reasons outside this repo's control.
// Each needs a reason and a recheck date — this list must not become a dumping
// ground for links nobody has looked at.
const KNOWN_UNREACHABLE = [
  {
    match: /journals\.ukh\.edu\.krd|10\.25079\/ukhjse/,
    reason:
      'UKH journal host no longer resolves (no DNS record). The DOI itself is validly ' +
      'registered and the Crossref metadata is intact, so the citation stays correct — ' +
      'only the publisher landing page is gone. Nothing we can fix.',
    since: '2026-07-29',
  },
  {
    match: /wiki\.openstreetmap\.org/,
    reason:
      'Connection times out from CI and from the maintainer network, though DNS resolves. ' +
      'Reachable in a normal browser. Ported in with the API directory.',
    since: '2026-07-29',
  },
];

if (!existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

const pages = walk(DIST);
const internal = new Map(); // href -> Set(source pages)
const external = new Map();

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const from = '/' + relative(DIST, page).replace(/index\.html$/, '').replace(/\\/g, '/');

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

    const target = /^https?:\/\//i.test(href) ? external : internal;
    if (!target.has(href)) target.set(href, new Set());
    target.get(href).add(from);
  }
}

/* --------------------------------------------------------------- internal */

const brokenInternal = [];

for (const [href, sources] of internal) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean === '/') continue;

  const rel = clean.replace(/^\//, '');
  const candidates = [
    join(DIST, rel),
    join(DIST, rel, 'index.html'),
    join(DIST, rel.replace(/\/$/, '') + '.html'),
    join(DIST, rel.replace(/\/$/, ''), 'index.html'),
  ];

  if (!candidates.some((c) => existsSync(c))) {
    brokenInternal.push({ href, sources: [...sources] });
  }
}

console.log(`Internal: ${internal.size} unique links across ${pages.length} pages`);
for (const b of brokenInternal) {
  console.error(`  BROKEN  ${b.href}  (from ${b.sources.join(', ')})`);
}

/* --------------------------------------------------------------- external */

let externalFailures = 0;
const suspects = [];

if (CHECK_EXTERNAL) {
  console.log(`\nExternal: probing ${external.size} unique links…`);

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

  for (const [href, sources] of external) {
    const known = KNOWN_UNREACHABLE.find((k) => k.match.test(href));
    if (known) {
      console.log(`  known-dead    ${href}`);
      console.log(`                ${known.reason} (since ${known.since})`);
      continue;
    }

    let status = 0;
    let note = '';

    for (const method of ['HEAD', 'GET']) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(href, {
          method,
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': UA },
        });
        clearTimeout(timer);
        status = res.status;
        if (res.ok || BLOCKED.has(status)) break;
      } catch (err) {
        note = err.name === 'AbortError' ? 'timeout' : err.message;
      }
    }

    if (status >= 200 && status < 400) {
      console.log(`  ok      ${status}  ${href}`);
    } else if (BLOCKED.has(status)) {
      console.log(`  bot-blocked ${status}  ${href} (fine in a browser)`);
    } else {
      // Do not fail on the first miss — transient blips are common across 180
      // links and a flaky check that blocks a deploy is worse than no check.
      suspects.push({ href, sources, status, note });
      console.log(`  retry?  ${status || note}  ${href}`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  if (suspects.length > 0) {
    console.log(`\nRe-checking ${suspects.length} suspect link(s) after a pause…`);
    await new Promise((r) => setTimeout(r, 5000));

    for (const s of suspects) {
      let status = 0;
      let note = '';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch(s.href, {
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': UA },
        });
        clearTimeout(timer);
        status = res.status;
      } catch (err) {
        note = err.name === 'AbortError' ? 'timeout' : err.message;
      }

      if ((status >= 200 && status < 400) || BLOCKED.has(status)) {
        console.log(`  recovered ${status}  ${s.href}`);
      } else {
        externalFailures++;
        console.error(`  BROKEN  ${status || note}  ${s.href}  (from ${[...s.sources][0]})`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
} else {
  console.log(`\nExternal: ${external.size} links found (pass --external to probe them)`);
}

const total = brokenInternal.length + externalFailures;
if (total > 0) {
  console.error(`\n${total} broken link(s).`);
  process.exit(1);
}
console.log('\nNo broken links.');
