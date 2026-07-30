#!/usr/bin/env node
/**
 * Fetches every feed in config/feeds.json, normalises the entries and writes
 * src/data/news.json.
 *
 * Guarantees:
 *   - A failing feed is logged and skipped. It never fails the run.
 *   - If every feed fails, the previous news.json is left untouched, so the News
 *     tab keeps showing the last good data rather than going blank.
 *   - Only title, link, source, timestamp and a short excerpt are stored. Full
 *     article text is never mirrored.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEEDS = join(ROOT, 'config/feeds.json');
const OUT = join(ROOT, 'src/data/news.json');

// MDPI (and others behind the same filter) reject any User-Agent containing a
// URL, so the conventional `+https://…` contact suffix is deliberately omitted.
// Verified: identical request 403s with the URL present, 200s without it.
const UA = 'Mozilla/5.0 (compatible; RSS reader)';
const TIMEOUT_MS = 20_000;
const EXCERPT_CHARS = 220;

/** Decodes the handful of entities that actually show up in feed titles. */
function decode(str) {
  return String(str ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

/** Atom puts the URL in an attribute; RSS puts it in the element body. */
function extractLink(block) {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decode(alt[1]);
  const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (href) return decode(href[1]);
  const body = tag(block, 'link');
  if (body) return body;
  return tag(block, 'guid');
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];

  return blocks
    .map((block) => {
      const title = tag(block, 'title');
      const link = extractLink(block);
      if (!title || !link) return null;

      const rawDate =
        tag(block, 'pubDate') ||
        tag(block, 'published') ||
        tag(block, 'updated') ||
        tag(block, 'dc:date') ||
        '';
      const date = new Date(rawDate);

      const rawExcerpt = tag(block, 'description') || tag(block, 'summary');
      const excerpt =
        rawExcerpt.length > EXCERPT_CHARS ? rawExcerpt.slice(0, EXCERPT_CHARS).trimEnd() + '…' : rawExcerpt;

      return {
        title,
        link,
        source: feed.name,
        category: feed.category ?? null,
        published: Number.isNaN(date.getTime()) ? null : date.toISOString(),
        excerpt: excerpt || null,
      };
    })
    .filter(Boolean);
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, { signal: controller.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml, feed);
    if (items.length === 0) throw new Error('no items parsed');
    return { ok: true, items };
  } finally {
    clearTimeout(timer);
  }
}

const config = JSON.parse(readFileSync(FEEDS, 'utf8'));
const maxItems = config.maxItems ?? 100;
const cutoff = config.maxAgeDays ? Date.now() - config.maxAgeDays * 86_400_000 : null;

const sources = [];
let all = [];

for (const feed of config.feeds) {
  try {
    const { items } = await fetchFeed(feed);
    all.push(...items);
    sources.push({ name: feed.name, ok: true, count: items.length, error: null });
    console.log(`  ok    ${String(items.length).padStart(3)} items  ${feed.name}`);
  } catch (err) {
    sources.push({ name: feed.name, ok: false, count: 0, error: err.message });
    console.warn(`  WARN  skipped        ${feed.name} — ${err.message}`);
  }
}

const okCount = sources.filter((s) => s.ok).length;

// Every feed failed: almost certainly a network-level problem on the runner.
// Keep the existing file rather than publishing an empty News tab.
if (okCount === 0) {
  console.error('\nAll feeds failed. Leaving the previous news.json untouched.');
  process.exit(0);
}

// Deduplicate by URL, keeping the first (newest-sorted) occurrence.
const seen = new Set();
const deduped = all
  .filter((item) => {
    if (cutoff && item.published && new Date(item.published).getTime() < cutoff) return false;
    const key = item.link.replace(/[?#].*$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0));

// Cap each source so a high-volume publisher cannot crowd out the rest.
// Without this the two MDPI feeds alone took 52% of the page and the
// petroleum journals — the whole point of the feed list — never appeared.
const perSourceCap = config.maxPerSource ?? Math.max(5, Math.ceil(maxItems / Math.max(1, okCount)) * 2);
const takenPerSource = new Map();
const balanced = [];
const overflow = [];

for (const item of deduped) {
  const n = takenPerSource.get(item.source) ?? 0;
  if (n < perSourceCap) {
    takenPerSource.set(item.source, n + 1);
    balanced.push(item);
  } else {
    overflow.push(item);
  }
}

// Backfill from the overflow if the cap left the page short.
const items = balanced.concat(overflow).slice(0, maxItems);

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { items: [] };

writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), sources, items }, null, 2) + '\n'
);

console.log(
  `\n${okCount}/${config.feeds.length} feeds ok · ${all.length} fetched · ${items.length} kept ` +
    `(was ${previous.items?.length ?? 0})`
);
