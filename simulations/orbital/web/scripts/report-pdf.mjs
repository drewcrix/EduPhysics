// Developer tool: render a Markdown document (default: docs/IMPLEMENTATION_REPORT.md) to PDF
// with the same Markdown/KaTeX stack as the app, printed by headless Chrome (Playwright).
//   node scripts/report-pdf.mjs [input.md] [output.pdf]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(process.argv[2] ?? join(here, '../../docs/IMPLEMENTATION_REPORT.md'));
const output = resolve(process.argv[3] ?? input.replace(/\.md$/, '.pdf'));
const md = readFileSync(input, 'utf8');
const body = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }, md));
const katexCss = pathToFileURL(join(here, '../node_modules/katex/dist/katex.min.css')).href;
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${katexCss}">
<style>
  body { font: 10.5pt/1.45 -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4pt; } h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9pt; page-break-inside: auto; }
  th, td { border: 1px solid #ccc; padding: 3pt 5pt; vertical-align: top; text-align: left; }
  th { background: #f2f4f8; } tr { page-break-inside: avoid; }
  code { font: 8.8pt/1.3 Menlo, Consolas, monospace; background: #f4f4f4; padding: 0 2pt; border-radius: 2pt; }
  pre { background: #f6f7f9; border: 1px solid #e3e3e3; padding: 6pt; overflow: hidden; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; } hr { border: 0; border-top: 1px solid #ddd; margin: 12pt 0; }
  blockquote { color: #444; border-left: 3px solid #ccc; margin: 6pt 0; padding-left: 8pt; }
</style></head><body>${body}</body></html>`;
const dir = mkdtempSync(join(tmpdir(), 'mca-report-'));
const page = join(dir, 'report.html');
writeFileSync(page, html);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const tab = await browser.newPage();
await tab.goto(pathToFileURL(page).href, { waitUntil: 'networkidle' });
await tab.pdf({
  path: output, format: 'A4', printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
  displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888">Mission Control Academy — Implementation Report · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
});
await browser.close();
console.log(`wrote ${output}`);
