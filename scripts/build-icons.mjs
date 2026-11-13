// build-icons.mjs - render icons/icon.svg to the PNG sizes the manifest needs.
// Usage: node scripts/build-icons.mjs [path-to-playwright-core] [chrome.exe]
// Needs playwright-core and a local Chrome/Edge; the PNGs are committed, so this only runs when the SVG changes.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pwPath = process.argv[2] || 'playwright-core';
const exe = process.argv[3] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { chromium } = await import(pwPath.endsWith('.js') || pwPath.includes('/') ? pathToUrl(pwPath) : pwPath);

function pathToUrl(p) {
	return new URL(`file:///${path.resolve(p).replace(/\\/g, '/')}`).href;
}

const svg = await readFile(path.join(root, 'icons', 'icon.svg'), 'utf8');
const browser = await chromium.launch({ executablePath: exe, headless: true });
for (const size of [16, 32, 48, 128]) {
	const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
	await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
	await page.locator('svg').screenshot({ path: path.join(root, 'icons', `icon${size}.png`), omitBackground: true });
	await page.close();
	console.log(`icons/icon${size}.png`);
}
await browser.close();
