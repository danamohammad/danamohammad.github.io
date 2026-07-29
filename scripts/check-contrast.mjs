#!/usr/bin/env node
/**
 * Verifies every foreground/background pair in the design system meets WCAG AA
 * in both themes. Values are the ones declared in src/styles/global.css.
 *
 * AA is 4.5:1 for body text and 3:1 for large text and UI boundaries.
 */

const THEMES = {
  light: {
    bg: '#fcfcfa',
    surface: '#ffffff',
    surface2: '#f4f4f0',
    text: '#1b1b19',
    textMuted: '#57574f',
    accent: '#0b5a68',
    accentBg: '#e6f2f4',
    borderStrong: '#cfcfc6',
    controlBorder: '#8a8a80',
  },
  dark: {
    bg: '#131311',
    surface: '#1b1b18',
    surface2: '#232320',
    text: '#ecebe5',
    textMuted: '#a8a59c',
    accent: '#6cc9da',
    accentBg: '#16323a',
    borderStrong: '#43433c',
    controlBorder: '#6b6b62',
  },
};

const PAIRS = [
  ['text', 'bg', 4.5, 'body text on page background'],
  ['text', 'surface', 4.5, 'body text on card'],
  ['text', 'surface2', 4.5, 'body text on code block'],
  ['textMuted', 'bg', 4.5, 'muted text on page background'],
  ['textMuted', 'surface', 4.5, 'muted text on card'],
  ['textMuted', 'surface2', 4.5, 'muted text on code block'],
  ['accent', 'bg', 4.5, 'link on page background'],
  ['accent', 'surface', 4.5, 'link on card'],
  ['accent', 'surface2', 4.5, 'link on code block'],
  ['accent', 'accentBg', 4.5, 'active nav item'],
  ['controlBorder', 'bg', 3.0, 'form control border on background'],
  ['controlBorder', 'surface', 3.0, 'form control border on card'],
];

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgb(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

let failures = 0;

for (const [theme, colors] of Object.entries(THEMES)) {
  console.log(`\n${theme.toUpperCase()}`);
  for (const [fg, bg, min, label] of PAIRS) {
    const r = ratio(colors[fg], colors[bg]);
    const pass = r >= min;
    if (!pass) failures++;
    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} contrast pair(s) below AA.`);
  process.exit(1);
}
console.log('\nAll pairs meet WCAG AA in both themes.');
