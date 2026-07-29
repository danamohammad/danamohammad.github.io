#!/usr/bin/env python3
"""
Static site generator. Standard library only - no pip installs, no Node, no Ruby.

    python build.py

Reads:
    site.config.json     site-wide settings
    content/articles/    *.md  -> /articles/<slug>/
    content/research/    *.md  -> /research/<slug>/
    data/apis.json       API directory -> /apis/

Writes (regenerated every run, do not hand-edit):
    index.html  articles/  research/  apis/  feed.xml  sitemap.xml
    robots.txt  404.html  CNAME  .nojekyll
"""

from __future__ import annotations

import html
import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
DATA = ROOT / "data"

# Directories this script owns and wipes on every build.
GENERATED_DIRS = ["articles", "research", "apis"]


# --------------------------------------------------------------------------
# Markdown
# --------------------------------------------------------------------------

CODE_SENTINEL = "\x00%d\x00"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text))
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "untitled"


def _inline(text: str) -> str:
    """Inline markdown -> HTML. Code spans are protected from every other rule."""
    spans: list[str] = []

    def stash(m: re.Match) -> str:
        spans.append(m.group(1))
        return CODE_SENTINEL % (len(spans) - 1)

    text = re.sub(r"`([^`]+)`", stash, text)
    text = html.escape(text, quote=False)

    text = re.sub(
        r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)',
        lambda m: f'<img src="{m.group(2)}" alt="{m.group(1)}" loading="lazy">',
        text,
    )
    text = re.sub(
        r'\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)',
        _link,
        text,
    )
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", text)

    return re.sub(
        r"\x00(\d+)\x00",
        lambda m: "<code>" + html.escape(spans[int(m.group(1))]) + "</code>",
        text,
    )


def _link(m: re.Match) -> str:
    label, url = m.group(1), m.group(2)
    external = url.startswith(("http://", "https://"))
    attrs = ' target="_blank" rel="noopener noreferrer"' if external else ""
    return f'<a href="{url}"{attrs}>{label}</a>'


def markdown(src: str) -> str:
    """A pragmatic Markdown subset: headings, code, lists, quotes, tables, rules."""
    lines = src.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # Fenced code block
        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            i += 1
            buf: list[str] = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1  # closing fence
            cls = f' class="language-{html.escape(lang)}"' if lang else ""
            body = html.escape("\n".join(buf))
            out.append(f"<pre><code{cls}>{body}</code></pre>")
            continue

        # Horizontal rule
        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            out.append("<hr>")
            i += 1
            continue

        # Heading
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            body = _inline(m.group(2).strip())
            anchor = slugify(re.sub(r"<[^>]+>", "", body))
            out.append(
                f'<h{level} id="{anchor}">'
                f'<a class="anchor" href="#{anchor}" aria-hidden="true">#</a>'
                f"{body}</h{level}>"
            )
            i += 1
            continue

        # Blockquote
        if stripped.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            out.append("<blockquote>" + markdown("\n".join(buf)) + "</blockquote>")
            continue

        # Table
        if "|" in stripped and i + 1 < n and re.fullmatch(
            r"\|?[\s:|-]+\|[\s:|-]*", lines[i + 1].strip()
        ):
            header = _row(stripped)
            i += 2
            body_rows = []
            while i < n and "|" in lines[i] and lines[i].strip():
                body_rows.append(_row(lines[i].strip()))
                i += 1
            thead = "".join(f"<th>{_inline(c)}</th>" for c in header)
            tbody = "".join(
                "<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>"
                for r in body_rows
            )
            out.append(
                '<div class="table-wrap"><table><thead><tr>'
                f"{thead}</tr></thead><tbody>{tbody}</tbody></table></div>"
            )
            continue

        # Lists (supports one level of nesting via 2-space indent)
        if re.match(r"^\s*([-*+]|\d+\.)\s+", line):
            block, i = _collect_list(lines, i)
            out.append(block)
            continue

        # Raw HTML block
        if stripped.startswith("<"):
            buf = []
            while i < n and lines[i].strip():
                buf.append(lines[i])
                i += 1
            out.append("\n".join(buf))
            continue

        # Paragraph
        buf = []
        while i < n and lines[i].strip() and not _starts_block(lines[i]):
            buf.append(lines[i].strip())
            i += 1
        out.append("<p>" + _inline(" ".join(buf)) + "</p>")

    return "\n".join(out)


def _starts_block(line: str) -> bool:
    s = line.strip()
    return bool(
        s.startswith(("```", ">", "#", "<"))
        or re.match(r"^\s*([-*+]|\d+\.)\s+", line)
        or re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s)
    )


def _row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


ITEM_RE = re.compile(r"^\s*([-*+]|\d+\.)\s+(.*)$")


def _collect_list(lines: list[str], start: int) -> tuple[str, int]:
    """Build a (possibly nested) list starting at `start`.

    A wrapped line belonging to an item is folded into that item's text; only
    indented lines that themselves start a marker open a nested list.
    """
    i = start
    n = len(lines)
    base_indent = len(lines[i]) - len(lines[i].lstrip())
    ordered = bool(re.match(r"^\s*\d+\.\s+", lines[i]))
    items: list[dict] = []

    while i < n:
        line = lines[i]

        if not line.strip():
            # A blank line ends the list unless the next line resumes the *same*
            # kind of list at the same or deeper indent.
            if i + 1 < n and ITEM_RE.match(lines[i + 1]):
                nxt = lines[i + 1]
                nxt_indent = len(nxt) - len(nxt.lstrip())
                nxt_ordered = bool(re.match(r"^\s*\d+\.\s+", nxt))
                if nxt_indent >= base_indent and nxt_ordered == ordered:
                    i += 1
                    continue
            break

        indent = len(line) - len(line.lstrip())
        m = ITEM_RE.match(line)

        if m and indent == base_indent:
            items.append({"text": m.group(2), "block": []})
            i += 1
        elif not items:
            break
        elif indent > base_indent:
            dedented = line[base_indent + 2 :] if len(line) > base_indent + 2 else line.strip()
            if ITEM_RE.match(dedented) or items[-1]["block"]:
                items[-1]["block"].append(dedented)
            else:
                items[-1]["text"] += " " + line.strip()
            i += 1
        elif items[-1]["block"] or _starts_block(line):
            break
        else:
            # Lazy continuation: an unindented wrapped line.
            items[-1]["text"] += " " + line.strip()
            i += 1

    tag = "ol" if ordered else "ul"
    rendered = []
    for item in items:
        inner = _inline(item["text"])
        if item["block"]:
            inner += markdown("\n".join(item["block"]))
        rendered.append(f"<li>{inner}</li>")
    return f"<{tag}>" + "".join(rendered) + f"</{tag}>", i


# --------------------------------------------------------------------------
# Front matter
# --------------------------------------------------------------------------

def parse_front_matter(raw: str) -> tuple[dict, str]:
    raw = raw.replace("\r\n", "\n")
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    head = raw[3:end].strip("\n")
    body = raw[end + 4 :].lstrip("\n")

    meta: dict = {}
    for line in head.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if value.startswith("[") and value.endswith("]"):
            meta[key] = [
                v.strip().strip('"').strip("'")
                for v in value[1:-1].split(",")
                if v.strip()
            ]
        elif value.lower() in ("true", "false"):
            meta[key] = value.lower() == "true"
        else:
            meta[key] = value
    return meta, body


def read_collection(folder: Path, kind: str) -> list[dict]:
    entries = []
    if not folder.exists():
        return entries
    for path in sorted(folder.glob("*.md")):
        meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
        if meta.get("draft"):
            continue
        # Slug follows the filename, not the title, so rewording a headline
        # never breaks a published URL. Override with `slug:` in front matter.
        slug = meta.get("slug") or slugify(path.stem)
        entries.append(
            {
                **meta,
                "kind": kind,
                "slug": slug,
                "url": f"/{kind}/{slug}/",
                "title": meta.get("title") or path.stem.replace("-", " ").title(),
                "date": str(meta.get("date") or ""),
                "summary": meta.get("summary", ""),
                "tags": meta.get("tags") or [],
                "html": markdown(body),
                "words": len(re.findall(r"\w+", body)),
                "source": path,
            }
        )
    entries.sort(key=lambda e: (e["date"], e["title"]), reverse=True)
    return entries


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------

def e(text) -> str:
    return html.escape(str(text or ""), quote=True)


def pretty_date(value: str) -> str:
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).strftime("%d %B %Y")
        except ValueError:
            continue
    return value


def page(cfg: dict, *, title: str, body: str, active: str = "",
         description: str = "", canonical: str = "/") -> str:
    nav = "".join(
        f'<a href="{e(item["url"])}"'
        f'{" class=\"active\"" if item["url"] == active else ""}>{e(item["label"])}</a>'
        for item in cfg["nav"]
    )
    footer = " · ".join(
        f'<a href="{e(l["url"])}">{e(l["label"])}</a>' for l in cfg.get("footer_links", [])
    )
    full_title = title if title == cfg["site_name"] else f"{title} — {cfg['site_name']}"
    desc = description or cfg["description"]
    year = datetime.now().year

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(full_title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="author" content="{e(cfg['author'])}">
<link rel="canonical" href="{e(cfg['base_url'].rstrip('/') + canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(full_title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(cfg['base_url'].rstrip('/') + canonical)}">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/rss+xml" title="{e(cfg['site_name'])}" href="/feed.xml">
<link rel="stylesheet" href="/assets/css/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>&#9670;</text></svg>">
<script>
  (function () {{
    var t = localStorage.getItem("theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  }})();
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/">{e(cfg['site_name'])}</a>
    <nav class="site-nav">{nav}</nav>
    <button class="theme-toggle" type="button" aria-label="Toggle colour theme"></button>
  </div>
</header>
<main id="main" class="wrap">
{body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>© {year} {e(cfg['author'])}</p>
    <p class="footer-links">{footer}</p>
  </div>
</footer>
<script src="/assets/js/site.js"></script>
</body>
</html>
"""


def card(entry: dict) -> str:
    tags = "".join(f'<span class="tag">{e(t)}</span>' for t in entry["tags"][:4])
    date = f'<time datetime="{e(entry["date"])}">{e(pretty_date(entry["date"]))}</time>' if entry["date"] else ""
    return f"""<article class="card">
  <h3><a href="{e(entry['url'])}">{e(entry['title'])}</a></h3>
  <p class="card-summary">{e(entry['summary'])}</p>
  <p class="card-meta">{date}{tags}</p>
</article>"""


# --------------------------------------------------------------------------
# Page builders
# --------------------------------------------------------------------------

def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def build_entry_pages(cfg: dict, entries: list[dict], kind: str) -> None:
    for entry in entries:
        meta_bits = []
        if entry["date"]:
            meta_bits.append(
                f'<time datetime="{e(entry["date"])}">{e(pretty_date(entry["date"]))}</time>'
            )
        if kind == "articles" and entry["words"]:
            meta_bits.append(f"{max(1, round(entry['words'] / 220))} min read")
        if entry.get("status"):
            meta_bits.append(f'<span class="pill">{e(entry["status"])}</span>')

        resources = []
        for key, label in (("pdf", "PDF"), ("doi", "DOI"), ("code", "Code"), ("data", "Data")):
            if entry.get(key):
                url = entry[key]
                if key == "doi" and not str(url).startswith("http"):
                    url = f"https://doi.org/{url}"
                resources.append(f'<a class="btn" href="{e(url)}">{label}</a>')

        tags = "".join(f'<span class="tag">{e(t)}</span>' for t in entry["tags"])

        body = f"""<article class="prose">
  <header class="entry-head">
    <p class="crumb"><a href="/{kind}/">&larr; All {kind}</a></p>
    <h1>{e(entry['title'])}</h1>
    <p class="entry-meta">{" · ".join(meta_bits)}</p>
    {f'<p class="lede">{e(entry["summary"])}</p>' if entry['summary'] else ''}
    {f'<p class="resources">{"".join(resources)}</p>' if resources else ''}
  </header>
  {entry['html']}
  {f'<footer class="entry-foot"><p class="tags">{tags}</p></footer>' if tags else ''}
</article>"""

        write(
            ROOT / kind / entry["slug"] / "index.html",
            page(cfg, title=entry["title"], body=body, active=f"/{kind}/",
                 description=entry["summary"], canonical=entry["url"]),
        )


def build_articles_index(cfg: dict, entries: list[dict]) -> None:
    cards = "\n".join(card(x) for x in entries) or '<p class="empty">Nothing published yet.</p>'
    body = f"""<header class="page-head">
  <h1>Articles</h1>
  <p class="lede">Long-form writing. {len(entries)} published.</p>
</header>
<div class="cards">{cards}</div>"""
    write(ROOT / "articles" / "index.html",
          page(cfg, title="Articles", body=body, active="/articles/", canonical="/articles/"))


def build_research_index(cfg: dict, entries: list[dict]) -> None:
    cards = "\n".join(card(x) for x in entries) or '<p class="empty">Nothing published yet.</p>'
    body = f"""<header class="page-head">
  <h1>Research</h1>
  <p class="lede">Papers, preprints and working notes. Anything citable is archived on
     <a href="https://zenodo.org" target="_blank" rel="noopener noreferrer">Zenodo</a> with a DOI.</p>
</header>
<div class="cards">{cards}</div>"""
    write(ROOT / "research" / "index.html",
          page(cfg, title="Research", body=body, active="/research/", canonical="/research/"))


def build_apis(cfg: dict, apis: list[dict]) -> None:
    categories = sorted({a.get("category", "Other") for a in apis})
    chips = "".join(
        f'<button class="chip" type="button" data-filter="{e(c)}">{e(c)}</button>'
        for c in categories
    )

    rows = []
    for a in sorted(apis, key=lambda x: (x.get("category", ""), x.get("name", ""))):
        badges = []
        if a.get("auth"):
            badges.append(f'<span class="badge badge-auth">{e(a["auth"])}</span>')
        if a.get("free_tier"):
            badges.append(f'<span class="badge badge-free">{e(a["free_tier"])}</span>')
        docs = (
            f'<a class="btn btn-sm" href="{e(a["docs"])}" target="_blank" rel="noopener noreferrer">Docs</a>'
            if a.get("docs") else ""
        )
        haystack = " ".join(
            str(a.get(k, "")) for k in ("name", "category", "description", "auth", "free_tier")
        ).lower()
        rows.append(f"""<article class="api" data-category="{e(a.get('category','Other'))}" data-search="{e(haystack)}">
  <div class="api-main">
    <h3>{e(a.get('name',''))}</h3>
    <p>{e(a.get('description',''))}</p>
    <p class="api-badges"><span class="badge badge-cat">{e(a.get('category','Other'))}</span>{"".join(badges)}</p>
  </div>
  <div class="api-actions">{docs}</div>
</article>""")

    body = f"""<header class="page-head">
  <h1>API Directory</h1>
  <p class="lede">{len(apis)} APIs I have actually used or vetted. Every one has a usable free tier.</p>
</header>
<div class="api-controls">
  <input type="search" id="api-search" placeholder="Search {len(apis)} APIs…" autocomplete="off" aria-label="Search APIs">
  <div class="chips">
    <button class="chip active" type="button" data-filter="all">All</button>
    {chips}
  </div>
</div>
<p class="result-count" id="api-count"></p>
<div class="api-list" id="api-list">
{"".join(rows)}
</div>
<p class="empty" id="api-empty" hidden>No APIs match that search.</p>"""

    write(ROOT / "apis" / "index.html",
          page(cfg, title="APIs", body=body, active="/apis/",
               description=f"A curated directory of {len(apis)} free and freemium APIs.",
               canonical="/apis/"))


def build_home(cfg: dict, articles: list[dict], research: list[dict], apis: list[dict]) -> None:
    recent_articles = "\n".join(card(x) for x in articles[:3]) or '<p class="empty">Coming soon.</p>'
    recent_research = "\n".join(card(x) for x in research[:2]) or '<p class="empty">Coming soon.</p>'

    body = f"""<section class="hero">
  <h1>{e(cfg['site_name'])}</h1>
  <p class="lede">{e(cfg['tagline'])}</p>
  <p class="hero-actions">
    <a class="btn btn-primary" href="/articles/">Read articles</a>
    <a class="btn" href="/apis/">Browse {len(apis)} APIs</a>
    <a class="btn" href="/research/">See research</a>
  </p>
</section>

<section class="stats">
  <div class="stat"><strong>{len(articles)}</strong><span>articles</span></div>
  <div class="stat"><strong>{len(apis)}</strong><span>APIs indexed</span></div>
  <div class="stat"><strong>{len(research)}</strong><span>research entries</span></div>
</section>

<section class="section">
  <div class="section-head"><h2>Latest articles</h2><a href="/articles/">All articles &rarr;</a></div>
  <div class="cards">{recent_articles}</div>
</section>

<section class="section">
  <div class="section-head"><h2>Research</h2><a href="/research/">All research &rarr;</a></div>
  <div class="cards">{recent_research}</div>
</section>"""

    write(ROOT / "index.html",
          page(cfg, title=cfg["site_name"], body=body, active="/", canonical="/"))


def build_feed(cfg: dict, entries: list[dict]) -> None:
    base = cfg["base_url"].rstrip("/")
    items = []
    for entry in entries[:25]:
        try:
            pub = datetime.strptime(entry["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            pub_str = pub.strftime("%a, %d %b %Y %H:%M:%S +0000")
        except ValueError:
            pub_str = ""
        items.append(f"""  <item>
    <title>{e(entry['title'])}</title>
    <link>{base}{entry['url']}</link>
    <guid isPermaLink="true">{base}{entry['url']}</guid>
    <description>{e(entry['summary'])}</description>
    {f'<pubDate>{pub_str}</pubDate>' if pub_str else ''}
  </item>""")

    write(ROOT / "feed.xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>{e(cfg['site_name'])}</title>
  <link>{base}/</link>
  <description>{e(cfg['description'])}</description>
  <language>en</language>
  <atom:link href="{base}/feed.xml" rel="self" type="application/rss+xml"/>
{chr(10).join(items)}
</channel>
</rss>
""")


def build_meta_files(cfg: dict, urls: list[str]) -> None:
    base = cfg["base_url"].rstrip("/")
    today = datetime.now().strftime("%Y-%m-%d")
    locs = "".join(
        f"  <url><loc>{base}{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls
    )
    write(ROOT / "sitemap.xml",
          '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          f"{locs}</urlset>\n")

    write(ROOT / "robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml\n")

    body = """<section class="hero">
  <h1>404</h1>
  <p class="lede">That page does not exist.</p>
  <p class="hero-actions"><a class="btn btn-primary" href="/">Go home</a></p>
</section>"""
    write(ROOT / "404.html", page(cfg, title="Not found", body=body, canonical="/404.html"))

    write(ROOT / ".nojekyll", "")

    # Only claim the custom domain once its DNS actually resolves. A CNAME file
    # pointing at an unregistered domain makes Pages redirect there and takes the
    # whole site offline, so this stays off until the is-a.dev PR is merged.
    cname = ROOT / "CNAME"
    if cfg.get("custom_domain_active") and cfg.get("domain"):
        write(cname, cfg["domain"] + "\n")
    elif cname.exists():
        cname.unlink()


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> None:
    cfg = json.loads((ROOT / "site.config.json").read_text(encoding="utf-8"))

    # Canonical URLs follow whichever domain is actually serving the site, so
    # sitemap/RSS/og:url can never drift out of sync with reality.
    cfg["base_url"] = (
        f"https://{cfg['domain']}"
        if cfg.get("custom_domain_active") and cfg.get("domain")
        else f"https://{cfg['github_user']}.github.io"
    )

    for name in GENERATED_DIRS:
        shutil.rmtree(ROOT / name, ignore_errors=True)

    articles = read_collection(CONTENT / "articles", "articles")
    research = read_collection(CONTENT / "research", "research")

    apis_file = DATA / "apis.json"
    apis = json.loads(apis_file.read_text(encoding="utf-8")) if apis_file.exists() else []

    build_entry_pages(cfg, articles, "articles")
    build_entry_pages(cfg, research, "research")
    build_articles_index(cfg, articles)
    build_research_index(cfg, research)
    build_apis(cfg, apis)
    build_home(cfg, articles, research, apis)
    build_feed(cfg, articles + research)
    build_meta_files(
        cfg,
        ["/", "/articles/", "/apis/", "/research/"]
        + [x["url"] for x in articles]
        + [x["url"] for x in research],
    )

    print(f"Built {len(articles)} articles, {len(research)} research entries, {len(apis)} APIs.")
    print(f"Output: {ROOT}")


if __name__ == "__main__":
    main()
