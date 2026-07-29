import type { APIRoute } from 'astro';
import { research, site } from '../../lib/site';

/** BibTeX escaping: braces and backslashes break the parser, so neutralise them. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/[\\]/g, '\\textbackslash{}')
    .replace(/([{}])/g, '\\$1')
    .replace(/[&%$#_]/g, (m) => '\\' + m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable, collision-resistant citation key: surname + year + first title word. */
function citeKey(pub: any, taken: Set<string>): string {
  const surname =
    String(pub.authors?.[0] ?? 'unknown')
      .split(',')[0]
      .replace(/[^A-Za-z]/g, '') || 'unknown';
  const word =
    String(pub.title ?? '')
      .split(/\s+/)
      .find((w: string) => w.replace(/[^A-Za-z]/g, '').length > 3)
      ?.replace(/[^A-Za-z]/g, '') ?? 'work';

  const base = `${surname}${pub.year ?? 'nd'}${word}`.toLowerCase();
  let key = base;
  let n = 1;
  while (taken.has(key)) key = `${base}${String.fromCharCode(96 + ++n)}`;
  taken.add(key);
  return key;
}

const TYPE_MAP: Record<string, string> = {
  article: 'article',
  preprint: 'misc',
  dataset: 'misc',
  software: 'misc',
  chapter: 'incollection',
  thesis: 'phdthesis',
  report: 'techreport',
};

export const GET: APIRoute = () => {
  const pubs = research.publications ?? [];
  const taken = new Set<string>();

  const header = [
    `% BibTeX export — ${site.name}`,
    `% ${pubs.length} entries, generated ${new Date().toISOString().slice(0, 10)}`,
    `% Source: ${site.site.customDomain ?? site.site.url}/research/`,
    '',
  ].join('\n');

  const entries = pubs.map((p: any) => {
    const fields: string[] = [];
    if (p.title) fields.push(`  title     = {${esc(p.title)}}`);
    if (p.authors?.length) fields.push(`  author    = {${p.authors.map(esc).join(' and ')}}`);
    if (p.venue) fields.push(`  journal   = {${esc(p.venue)}}`);
    if (p.year) fields.push(`  year      = {${p.year}}`);
    if (p.publisher) fields.push(`  publisher = {${esc(p.publisher)}}`);
    if (p.doi) fields.push(`  doi       = {${esc(p.doi)}}`);
    if (p.url ?? p.doi) fields.push(`  url       = {${p.url ?? `https://doi.org/${p.doi}`}}`);

    return `@${TYPE_MAP[p.type] ?? 'misc'}{${citeKey(p, taken)},\n${fields.join(',\n')}\n}`;
  });

  return new Response(header + entries.join('\n\n') + '\n', {
    headers: {
      'Content-Type': 'application/x-bibtex; charset=utf-8',
      'Content-Disposition': 'attachment; filename="khidhir-publications.bib"',
    },
  });
};
