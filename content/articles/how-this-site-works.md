---
title: How this site works
date: 2026-07-29
summary: A static site with no build dependencies, no framework and no hosting bill. Here is the whole architecture in one page.
tags: [meta, static-site, python]
---

This site has three jobs: publish articles, keep a directory of APIs that are actually
worth using, and archive research so it can be cited. It does all three from a folder of
plain text files and a single Python script.

There is no framework, no `node_modules`, and nothing to install. That is deliberate — a
personal site should still build in five years without a dependency archaeology session.

## The stack

| Layer | Choice | Cost |
| --- | --- | --- |
| Content | Markdown files | — |
| Build | One Python script, stdlib only | — |
| Hosting | GitHub Pages | Free |
| Domain | is-a.dev subdomain | Free |
| Research archive | Zenodo (DOIs) | Free |

Total running cost: nothing. No account can lapse and take the site down with it.

## Writing something new

Every article is one Markdown file in `content/articles/`. The front matter block at the
top is all the metadata the build needs:

```markdown
---
title: Your title here
date: 2026-07-29
summary: One sentence that appears in listings and search results.
tags: [research, apis]
---

Your writing starts here.
```

Then rebuild:

```bash
python build.py
```

The script reads every Markdown file, converts it to HTML, and regenerates the index
pages, the RSS feed and the sitemap. Adding `draft: true` to the front matter keeps a
piece out of the build until it is ready.

## Why Markdown and not a CMS

A CMS puts your writing inside somebody else's database. Markdown files in Git give you
three things a CMS cannot:

- **Full history.** Every revision of every article is recoverable.
- **Portability.** If GitHub Pages disappears, the same folder deploys to Netlify,
  Cloudflare Pages or a VPS without changing a single file.
- **Grep.** Searching your own archive is `grep -r`, not a web UI.

## The API directory

The API list lives in `data/apis.json`, and the build renders it into a static page with
client-side search and category filters. Because the HTML is generated at build time
rather than fetched at runtime, the list is fully indexable by search engines and works
with JavaScript disabled — the filtering is a progressive enhancement on top.

Adding an entry is four fields:

```json
{
  "name": "Open-Meteo",
  "category": "Geo & Weather",
  "description": "Forecast and historical weather data with no API key at all.",
  "auth": "None",
  "free_tier": "Free non-commercial",
  "docs": "https://open-meteo.com/en/docs"
}
```

One caveat worth stating plainly: free tiers change. The labels in the directory describe
the shape of the offer, not a guaranteed quota. Always check the provider's current
pricing page before you build something that depends on it.

## Research and DOIs

A blog post is not citable. If a piece of research needs to be referenced by someone else,
it gets deposited on [Zenodo](https://zenodo.org), which mints a permanent DOI and
guarantees the archive outlives any particular website. The entry here then links to it.

That separation matters: this site is the readable front end, Zenodo is the permanent
record.

## What it costs to keep running

Nothing, and that is the point. GitHub Pages serves static files at no charge, the is-a.dev
registry hands out subdomains for free to developers, and Zenodo is funded by CERN. The
only thing that can break this site is me writing bad Markdown.
