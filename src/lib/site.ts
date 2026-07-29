/**
 * Single access point for the JSON config files. Pages import from here rather
 * than reading JSON directly, so the shape is declared in exactly one place.
 */
import siteConfig from '../../config/site.json';
import apisConfig from '../../config/apis.json';
import feedsConfig from '../../config/feeds.json';
import directoryConfig from '../../config/directory.json';
import researchData from '../data/research.json';
import newsData from '../data/news.json';

export const site = siteConfig;
export const apis = apisConfig;
export const feeds = feedsConfig;
export const directory = directoryConfig;
export const research = researchData;
export const news = newsData;

/** True when a config string is still an unfilled intake placeholder. */
export function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.includes('PLACEHOLDER');
}

/** Strips placeholder entries so half-filled config never ships as real copy. */
export function realOnly<T>(items: T[], pick: (item: T) => unknown): T[] {
  return items.filter((item) => !isPlaceholder(pick(item)));
}

export const NAV = [
  { href: '/', label: 'About' },
  { href: '/research/', label: 'Research' },
  { href: '/apis/', label: 'APIs' },
  { href: '/directory/', label: 'Directory' },
  { href: '/news/', label: 'News' },
  { href: '/blog/', label: 'Blog' },
] as const;

/** Marks the current nav item, treating `/research` and `/research/` as equal. */
export function isCurrent(href: string, pathname: string): boolean {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  const h = norm(href);
  const p = norm(pathname);
  return h === '/' ? p === '/' : p === h || p.startsWith(h + '/');
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
