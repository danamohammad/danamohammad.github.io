// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';

const site = JSON.parse(readFileSync(new URL('./config/site.json', import.meta.url), 'utf8'));

// The canonical origin. `customDomain` wins once the is-a.dev record resolves;
// until then everything builds against the github.io fallback, which must keep
// working independently of the custom domain.
const origin = site.site.customDomain ?? site.site.url;

// https://astro.build/config
export default defineConfig({
  site: origin,
  output: 'static',
  integrations: [sitemap()],
  build: {
    // Emit `/research/index.html` rather than `/research.html`, so every route
    // resolves on GitHub Pages with or without the trailing slash.
    format: 'directory',
  },
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: false,
    },
  },
});
