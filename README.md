# danamohammad.github.io

Personal site for Dr. Dana Mohammad Khidhir — research, APIs, an API directory, news and
writing. Static Astro site, hosted free on GitHub Pages, with data refreshed automatically
by GitHub Actions.

**Live:** https://danamohammad.github.io
**Planned custom domain:** `danakhidhir.is-a.dev` (free, see [Custom domain](#custom-domain))

Everything here costs nothing to run: no paid hosting, no paid domain, no paid API.

---

## How it works

The site is fully static. Once built, it needs no server and keeps working with every one
of your machines switched off.

```
config/*.json      you edit these — they drive the whole site
scripts/*.mjs      fetch data from ORCID, Crossref, Zenodo and RSS feeds
src/data/*.json    generated data, committed to the repo
src/pages/         the six routes
.github/workflows/ build, deploy and the two scheduled data refreshes
```

Generated data is **committed to the repo** on purpose. The site stays fast, it survives an
upstream API being down, and every data change is visible in `git log`.

### Routes

| Route | What it is | Source |
|---|---|---|
| `/` | About, portrait, current focus | `config/site.json` |
| `/research/` | Publications, filterable, with BibTeX export | `src/data/research.json` |
| `/apis/` | Documentation for your three APIs | `config/apis.json` |
| `/directory/` | Curated directory of third-party APIs | `config/directory.json` |
| `/news/` | Aggregated headlines, grouped by day | `src/data/news.json` |
| `/blog/` | Your articles | `src/content/blog/*.md` |

Plus `/rss.xml`, `/sitemap-index.xml`, `/robots.txt` and `/research/bibtex.bib`.

---

## Common tasks

### Add a blog post

Create `src/content/blog/my-post.md`:

```markdown
---
title: My post title
description: One sentence, used in listings, RSS and social cards.
date: 2026-07-30
tags: [reservoir, pvt]
draft: false
---

Body text in Markdown.
```

Set `draft: true` to keep it out of the build while you work. Tag pages are generated
automatically at `/blog/tags/<tag>/`. Commit and push — the site rebuilds and deploys itself.

### Add or remove an RSS feed

Edit `config/feeds.json` and add an object to `feeds`:

```json
{ "name": "Journal name", "url": "https://example.org/rss", "category": "reservoir" }
```

**Test the URL before committing** — a surprising number of publisher feeds are dead or
block bots:

```bash
npm run fetch:news
```

A failing feed is skipped with a warning and never breaks the build. Feeds already checked
and rejected are listed in the `_verified` field in that file, so you do not retry them.

### Add or edit an API endpoint

Everything on `/apis/` comes from `config/apis.json`. Add an object to the relevant API's
`endpoints` array:

```json
{
  "method": "POST",
  "path": "/v1/web/example",
  "summary": "What it does.",
  "parameters": [
    { "name": "url", "in": "body", "type": "string", "required": true, "description": "…" }
  ]
}
```

The cURL, JavaScript and Python snippets are **generated from the parameter definitions** —
you never write them by hand. `in` may be `query`, `body`, `form` or `path`.

### Change an API base URL

One field, one edit. In `config/apis.json`, find the API and change:

```json
"baseUrl": "https://api.example.com",
"baseUrlIsPublic": true
```

Setting `baseUrlIsPublic: true` removes the "not publicly routable" note. Nothing else needs
changing — the snippets and tables all read this single value.

### Update your bio or details

`config/site.json`. Any field still containing the word `PLACEHOLDER` is **hidden from the
site** rather than rendered, so a half-filled config never ships as broken copy.

Currently outstanding:
- `links[].href` for LinkedIn
- `links[].href` for Zenodo (needs your public profile URL)

### Add your portrait

Drop the image at `public/img/dana.jpg`, then in `config/site.json`:

```json
"portrait": { "src": "/img/dana.jpg", "alt": "Portrait of Dr. Dana Mohammad Khidhir", "isPlaceholder": false }
```

Ideally square, at least 800×800. The placeholder silhouette ships until then.

### Re-run a data workflow by hand

```bash
gh workflow run fetch-research.yml
gh workflow run fetch-news.yml
gh workflow run deploy.yml
```

Watch it: `gh run watch`. Or locally, without touching CI:

```bash
npm run fetch:all
```

### Rotate a token

No tokens are needed today — every data source used is public and unauthenticated. If you
later add one (for example a SerpAPI key for Scholar):

1. `gh secret set SERPAPI_KEY` — paste the value when prompted.
2. Reference it in the workflow as `${{ secrets.SERPAPI_KEY }}` and pass it as an env var.
3. Never put it in a file. `npm run check:secrets` runs in CI and fails the build if a
   credential reaches source **or built output**.

---

## Publications

`/research/` merges four sources, deduplicated by DOI first and then by normalised title:

| Source | Role | Notes |
|---|---|---|
| **ORCID public API** | primary | Free, no auth, never blocks CI. You curate it. |
| **Crossref** | enrichment | Turns a bare DOI into authors, venue, publisher, citations. |
| **Zenodo** | wired, currently empty | Returns 0 records for your ORCID — nothing deposited yet. |
| **`config/extra-publications.json`** | hand-maintained | Where Google Scholar entries live. |

**Google Scholar has no API and blocks automated access** — it captcha-walls CI runners
hard. It is therefore never queried from a workflow. The 20 Scholar publications currently
in the list were fetched once from a real machine and written into
`config/extra-publications.json`, with DOIs resolved against Crossref.

To refresh Scholar data, add new entries to that file by hand. Only `title` and `year` are
required; supply a `doi` and everything else is filled in from Crossref automatically.

### Deposit on Zenodo to make Zenodo work

The Zenodo path is fully implemented and will populate the moment you deposit anything under
ORCID `0000-0003-4181-5516`. Note that **Zenodo DOIs are permanent and public** — only
deposit what you intend to be citable forever.

---

## Local development

```bash
npm install
npm run dev
```

Then <http://localhost:4321>.

### Checks

```bash
npm run check
```

Runs, in order: contrast → build → secret scan → link check.

| Command | What it does |
|---|---|
| `npm run check:contrast` | WCAG AA for every colour pair, both themes |
| `npm run check:secrets` | Credential scan of source **and** `dist/` |
| `npm run check:links` | Internal links; add `-- --external` to probe outbound ones |

The external link check treats `401/403/405/429/503` as *bot-blocked*, not broken. Publishers
including MDPI and ScienceDirect answer 403 to any non-browser client; those links work fine
in a browser and must not fail the build.

---

## Deployment

Push to `main` → `deploy.yml` builds and publishes to GitHub Pages. Nothing else to do.

The Pages source is set to **GitHub Actions** (not "deploy from branch").

### The GITHUB_TOKEN trap

A commit pushed by a workflow using the default `GITHUB_TOKEN` **does not trigger other
workflows**. If the data workflows just committed and hoped `on: push` would fire, the site
would fetch fresh data forever and never rebuild.

So `fetch-research.yml` and `fetch-news.yml` **call `deploy.yml` directly** via
`workflow_call`, and only when the data actually changed:

```yaml
deploy:
  needs: fetch
  if: needs.fetch.outputs.changed == 'true'
  uses: ./.github/workflows/deploy.yml
```

### Schedules

| Workflow | Cron | Frequency |
|---|---|---|
| `fetch-research.yml` | `17 3,15 * * *` | every 12h |
| `fetch-news.yml` | `42 */6 * * *` | every 6h |

All three have `workflow_dispatch`, so they can be run on demand.

---

## Failure behaviour

Both pipelines are built so that an upstream outage is invisible to visitors. This is
tested, not assumed:

- **One feed fails** → skipped with a warning, the other feeds still publish.
- **Every feed fails** → `news.json` is left untouched; the News tab keeps the last good data.
- **ORCID or Crossref fails** → the manual store still publishes; the source is flagged
  `ok: false` in `research.json` and a note appears on the page.
- **Publication count would drop by more than half** → the run refuses to write and exits
  non-zero, because that almost always means a source silently returned nothing. Override
  with `FORCE=1` when the drop is intended.

---

## Custom domain

The target is `danakhidhir.is-a.dev` — free, and verified available.

is-a.dev is volunteer-run, so the record is not guaranteed forever. **`danamohammad.github.io`
remains the permanent fallback and must keep working independently.** Nothing in the build
depends on the custom domain.

To register, once the site is complete and live:

1. Fork `github.com/is-a-dev/register`.
2. Add `domains/danakhidhir.json` pointing at GitHub Pages per the current is-a.dev docs.
3. Open the PR with real contact details in the `owner` key.
4. When it merges, add `public/CNAME` containing `danakhidhir.is-a.dev`, set
   `site.customDomain` in `config/site.json`, and enable **Enforce HTTPS** in Pages settings
   once the certificate provisions.

The maintainers require registered subdomains to be **non-commercial**.

### Publishing pricing

Per-call pricing, x402/USDC payment mechanics and prepaid-credit rates are **deliberately
not published** on this site — pricing tables are the clearest commercial signal there is
and would put the is-a.dev registration at risk. `config/apis.json` documents free
evaluation access only.

If you move to a paid domain later, pricing can be reinstated: it is a content change to
`config/apis.json`, not a code change.

---

## Notes and known data issues

- The UKH asphaltene paper is registered under **two DOIs** (`v4n1` and `v4n2` of the same
  issue). The `v4n2` record is used; `v4n1` is kept as `alternateDoi`.
- One Scholar entry (*Entropy generation in radiative bioconvective Maxwell nanofluid flow*)
  has no Crossref match and therefore no DOI yet.
- Your Google Scholar profile lists your affiliation as Komar University, while
  `config/site.json` says Knowledge University per your intake. Worth correcting on Scholar.
- Zero web fonts are used. The type is a system stack, which costs 0 KB and renders instantly.

## Recovering the previous site

The Python static-site version that this replaced is preserved at tag `python-site`:

```bash
git show python-site:build.py
git checkout python-site
```
