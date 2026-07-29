#!/usr/bin/env node
/**
 * Builds src/data/research.json from four sources, merged and deduplicated.
 *
 *   1. ORCID public API  — primary. Dana curates it, it needs no auth, it is not
 *                          rate-limited in practice and it never blocks CI.
 *   2. Crossref          — enrichment. Turns a bare DOI into full metadata, and
 *                          contributes any extra works filed against the ORCID.
 *   3. Zenodo            — kept wired for when Dana starts depositing. Currently
 *                          returns zero records for this ORCID.
 *   4. extra-publications.json — the hand-maintained store. Also where Google
 *                          Scholar entries live, since Scholar cannot be queried
 *                          from a CI runner without getting captcha-walled.
 *
 * Every source is individually non-fatal. If a source fails, its last known
 * entries survive via the previous research.json, and the run still succeeds.
 *
 * Verified API behaviour that this script depends on (checked 2026-07-29):
 *   - Zenodo `size` caps at 25 for anonymous requests; size=100 is a 400.
 *   - Zenodo `sort=mostrecent` is newest-first; `-mostrecent` is OLDEST-first.
 *   - Zenodo publication_date is free text and arrives with stray whitespace,
 *     so ordering is always done client-side.
 *   - Zenodo indexes InvenioRDM field names but serialises legacy ones:
 *     query `creators.orcid`, read `metadata.creators[].orcid`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = JSON.parse(readFileSync(join(ROOT, 'config/site.json'), 'utf8'));
const EXTRA = JSON.parse(readFileSync(join(ROOT, 'config/extra-publications.json'), 'utf8'));
const OUT = join(ROOT, 'src/data/research.json');

const ORCID = SITE.ids.orcid;
const MAILTO = 'danamohammadkhidhir@gmail.com';
const UA = `dana-research-sync/1.0 (mailto:${MAILTO})`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const stripHtml = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const TYPE_FROM_CROSSREF = {
  'journal-article': 'article',
  'posted-content': 'preprint',
  'proceedings-article': 'article',
  'book-chapter': 'chapter',
  dataset: 'dataset',
  report: 'report',
  dissertation: 'thesis',
};

async function getJson(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...extraHeaders },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------ 1. ORCID ---- */

async function fromOrcid() {
  const data = await getJson(`https://pub.orcid.org/v3.0/${ORCID}/works`);
  const dois = [];

  for (const group of data.group ?? []) {
    const summary = group['work-summary']?.[0];
    if (!summary) continue;
    const doi = (group['external-ids']?.['external-id'] ?? []).find(
      (e) => e['external-id-type'] === 'doi'
    );
    dois.push({
      doi: doi ? String(doi['external-id-value']).toLowerCase() : null,
      title: summary.title?.title?.value ?? null,
      year: summary['publication-date']?.year?.value ? Number(summary['publication-date'].year.value) : null,
      venue: summary['journal-title']?.value ?? null,
    });
  }
  return dois;
}

/* --------------------------------------------------------- 2. Crossref ---- */

function fromCrossrefItem(item) {
  return {
    title: Array.isArray(item.title) ? item.title[0] : item.title,
    authors: (item.author ?? []).map((a) => [a.family, a.given].filter(Boolean).join(', ')).filter(Boolean),
    year:
      item.issued?.['date-parts']?.[0]?.[0] ??
      item['published-print']?.['date-parts']?.[0]?.[0] ??
      item['published-online']?.['date-parts']?.[0]?.[0] ??
      null,
    venue: item['container-title']?.[0] ?? item.event?.name ?? null,
    publisher: item.publisher ?? null,
    doi: item.DOI ? item.DOI.toLowerCase() : null,
    url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : null),
    pdf: (item.link ?? []).find((l) => l['content-type'] === 'application/pdf')?.URL ?? null,
    type: TYPE_FROM_CROSSREF[item.type] ?? 'article',
    abstract: item.abstract ? stripHtml(item.abstract).slice(0, 400) : null,
    citations: typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : null,
    source: 'crossref',
  };
}

async function crossrefByDoi(doi) {
  const item = (await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${MAILTO}`))
    .message;
  return fromCrossrefItem(item);
}

async function crossrefByOrcid() {
  const data = await getJson(
    `https://api.crossref.org/works?filter=orcid:${ORCID}&rows=100&mailto=${MAILTO}`
  );
  return (data.message?.items ?? []).map(fromCrossrefItem);
}

/* ----------------------------------------------------------- 3. Zenodo ---- */

async function fromZenodo() {
  const out = [];
  const SIZE = 25; // anonymous cap — 100 is rejected outright

  for (let page = 1; page <= 8; page++) {
    const url =
      `https://zenodo.org/api/records?q=${encodeURIComponent(`creators.orcid:"${ORCID}"`)}` +
      `&size=${SIZE}&page=${page}&sort=mostrecent`;
    const data = await getJson(url);
    const hits = data.hits?.hits ?? [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      const m = hit.metadata ?? {};
      out.push({
        title: m.title ?? null,
        authors: (m.creators ?? []).map((c) => c.name).filter(Boolean),
        year: parseInt(String(m.publication_date ?? '').trim().slice(0, 4), 10) || null,
        venue: m.journal?.title ?? null,
        publisher: 'Zenodo',
        doi: hit.doi ? String(hit.doi).toLowerCase() : null,
        url: hit.links?.self_html ?? hit.doi_url ?? null,
        pdf: (hit.files ?? []).find((f) => /\.pdf$/i.test(f.key ?? ''))?.links?.self ?? null,
        type: m.resource_type?.type === 'software' ? 'software' : m.resource_type?.type === 'dataset' ? 'dataset' : 'article',
        abstract: m.description ? stripHtml(m.description).slice(0, 400) : null,
        citations: null,
        source: 'zenodo',
      });
    }

    if (hits.length < SIZE) break;
    await sleep(1200); // search endpoint allows 30 req/min
  }
  return out;
}

/* ------------------------------------------------------------- merge ------ */

/** Later sources fill gaps in earlier ones; they never overwrite a real value. */
function fold(into, from) {
  for (const key of ['title', 'venue', 'publisher', 'url', 'pdf', 'abstract', 'year', 'type']) {
    if (into[key] == null || into[key] === '') into[key] = from[key] ?? into[key];
  }
  if (!into.authors?.length && from.authors?.length) into.authors = from.authors;
  if (into.citations == null && from.citations != null) into.citations = from.citations;
  return into;
}

function merge(groups) {
  const byDoi = new Map();
  const byTitle = new Map();
  const ordered = [];

  for (const pub of groups.flat()) {
    if (!pub?.title) continue;
    const doi = pub.doi ? String(pub.doi).toLowerCase() : null;
    const titleKey = norm(pub.title);

    const existing = (doi && byDoi.get(doi)) || byTitle.get(titleKey);
    if (existing) {
      fold(existing, pub);
      if (doi && !existing.doi) {
        existing.doi = doi;
        byDoi.set(doi, existing);
      }
      continue;
    }

    const entry = { ...pub, doi };
    ordered.push(entry);
    if (doi) byDoi.set(doi, entry);
    byTitle.set(titleKey, entry);
  }

  return ordered.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || String(a.title).localeCompare(String(b.title)));
}

/* -------------------------------------------------------------- run ------- */

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { publications: [], sources: {} };
const sources = {};
const collected = [];

// Manual store first: it is always available and always authoritative for
// anything Dana has typed by hand.
const manual = (EXTRA.publications ?? []).map((p) => ({ ...p, source: p.source ?? 'manual' }));
sources.manual = { ok: true, count: manual.length, error: null };
collected.push(manual);
console.log(`  manual    ${manual.length} entries`);

// ORCID -> DOIs -> Crossref enrichment.
let orcidWorks = [];
try {
  orcidWorks = await fromOrcid();
  sources.orcid = { ok: true, count: orcidWorks.length, lastSuccess: new Date().toISOString(), error: null };
  console.log(`  orcid     ${orcidWorks.length} works`);
} catch (err) {
  sources.orcid = { ...(previous.sources?.orcid ?? {}), ok: false, error: err.message };
  console.warn(`  WARN orcid failed — ${err.message}`);
}

const known = new Set(manual.filter((p) => p.doi).map((p) => String(p.doi).toLowerCase()));
const enriched = [];
for (const work of orcidWorks) {
  if (!work.doi) {
    enriched.push({ ...work, authors: [], type: 'article', source: 'orcid' });
    continue;
  }
  if (known.has(work.doi)) continue; // already fully described in the manual store
  try {
    enriched.push({ ...(await crossrefByDoi(work.doi)), source: 'orcid' });
    await sleep(350);
  } catch (err) {
    console.warn(`  WARN crossref ${work.doi} — ${err.message}`);
    enriched.push({ ...work, authors: [], type: 'article', source: 'orcid' });
  }
}
collected.push(enriched);

try {
  const extra = await crossrefByOrcid();
  sources.crossref = { ok: true, count: extra.length, lastSuccess: new Date().toISOString(), error: null };
  collected.push(extra);
  console.log(`  crossref  ${extra.length} works filed against the ORCID`);
} catch (err) {
  sources.crossref = { ...(previous.sources?.crossref ?? {}), ok: false, error: err.message };
  console.warn(`  WARN crossref-by-orcid failed — ${err.message}`);
}

try {
  const zenodo = await fromZenodo();
  sources.zenodo = {
    ok: true,
    count: zenodo.length,
    lastSuccess: new Date().toISOString(),
    error: null,
    ...(zenodo.length === 0 ? { note: 'no records deposited under this ORCID yet' } : {}),
  };
  collected.push(zenodo);
  console.log(`  zenodo    ${zenodo.length} records`);
} catch (err) {
  sources.zenodo = { ...(previous.sources?.zenodo ?? {}), ok: false, error: err.message };
  console.warn(`  WARN zenodo failed — ${err.message}`);
}

// Scholar is never queried from CI. Its contribution lives in the manual store.
sources.scholar = {
  ok: true,
  count: manual.filter((p) => p.source === 'scholar').length,
  note: 'seeded by hand; Scholar blocks automated access from CI runners',
};

const publications = merge(collected);

// Refuse to publish a large regression caused by a bad run. A partial upstream
// outage can still return *some* data, so a zero-check alone is not enough:
// losing the manual store drops the list from 23 to 6 without ever hitting zero.
// Set FORCE=1 when the drop is intentional.
const before = previous.publications?.length ?? 0;
if (before > 0 && publications.length < before * 0.5 && process.env.FORCE !== '1') {
  console.error(
    `\nRefusing to write: publication count would fall from ${before} to ${publications.length} ` +
      `(more than half). This usually means a source silently returned nothing.\n` +
      `Re-run with FORCE=1 if the drop is intended.`
  );
  process.exit(1);
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sources,
      metrics: SITE.metrics ?? null,
      publications,
    },
    null,
    2
  ) + '\n'
);

const withDoi = publications.filter((p) => p.doi).length;
console.log(
  `\n${publications.length} publications (${withDoi} with DOI) — was ${previous.publications?.length ?? 0}`
);
