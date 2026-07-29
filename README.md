# Personal site

Articles, a curated API directory, and research — a static site with **zero build
dependencies**. Python standard library only. No Node, no Ruby, no `npm install`.

Hosted free on GitHub Pages at a free `is-a.dev` domain.

## Quick start

```bash
python build.py
```

That regenerates every HTML page, the RSS feed and the sitemap. Then commit and push —
GitHub Pages deploys automatically within a minute.

To preview locally before pushing:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Adding content

### A new article

Create `content/articles/my-article.md`:

```markdown
---
title: My article
date: 2026-07-29
summary: One sentence for listings and RSS.
tags: [topic]
---

Body text in Markdown.
```

Copy `content/articles/_template.md` as a starting point. Set `draft: true` to keep a
piece out of the build while you work on it.

### A new API

Append an object to `data/apis.json`:

```json
{
  "name": "Service name",
  "category": "Developer",
  "description": "What it does and why it is worth using.",
  "auth": "API key",
  "free_tier": "Free tier",
  "docs": "https://example.com/docs"
}
```

Categories create their own filter chip automatically — no other change needed.

### A new research entry

Create `content/research/my-paper.md`. Same front matter as an article, plus any of:

```markdown
status: preprint
doi: 10.5281/zenodo.1234567
pdf: /assets/papers/my-paper.pdf
code: https://github.com/user/repo
data: https://example.com/dataset
```

Each present field renders as a button on the entry page.

## Layout

```
build.py             the entire generator
site.config.json     name, domain, nav, social links
content/articles/    *.md  ->  /articles/<slug>/
content/research/    *.md  ->  /research/<slug>/
data/apis.json       ->  /apis/
assets/css, assets/js
```

Everything else in the repository root is **generated** — `index.html`, `articles/`,
`research/`, `apis/`, `feed.xml`, `sitemap.xml`, `robots.txt`, `404.html`. Do not edit
those by hand; `build.py` overwrites them on every run.

## Deploying

Push to `main` on `danamohammad.github.io`. Pages rebuilds automatically, usually within
a minute.

Live at <https://danamohammad.github.io>.

## Custom domain

The custom domain is controlled by two keys in `site.config.json`:

```json
"domain": "danakhidhir.is-a.dev",
"custom_domain_active": false
```

While `custom_domain_active` is `false`, no `CNAME` file is written and `base_url`
resolves to `https://<github_user>.github.io`.

**Do not set it to `true` until the domain's DNS actually resolves.** GitHub Pages treats
a `CNAME` file as authoritative and redirects every request to that hostname — if the
domain does not exist yet, the whole site becomes unreachable.

Once the `is-a.dev` pull request is merged and DNS has propagated:

1. Set `"custom_domain_active": true`
2. `python build.py` — this writes the `CNAME` file and rewrites every canonical URL
3. Commit and push

`base_url` is derived, never hand-written, so canonical URLs, `sitemap.xml` and the RSS
feed always agree with whichever domain is really serving the site.

## Licence

Code: MIT. Written content: CC BY 4.0 unless a page states otherwise.
