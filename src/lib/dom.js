// dom.js - tiny safe DOM helpers. User data is ALWAYS set via textContent / properties, never innerHTML.
import { safeLink } from './model.js';

/**
 * h('div', { class: 'x', onclick: fn, dataset: {id: 1} }, 'text', childEl, [more])
 * Strings become text nodes. null/false children are skipped.
 */
export function h(tag, props = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props || {})) {
		if (v === null || v === undefined || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'value') el.value = v;
		else if (k === 'dataset') Object.assign(el.dataset, v);
		else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
		else if (k === 'href') {
			const safe = safeLink(v);
			if (safe) el.setAttribute('href', safe);
		} else if (k in el && typeof v !== 'string') el[k] = v;
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	append(el, children);
	return el;
}

function append(el, kids) {
	for (const c of kids.flat(Infinity)) {
		if (c === null || c === undefined || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
	while (el.firstChild) el.firstChild.remove();
	return el;
}

/** Apply theme to <html>: auto follows the OS. */
export function applyTheme(theme) {
	const t = theme === 'auto' || !theme ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
	document.documentElement.dataset.theme = t;
}

let toastTimer = 0;
/** Bottom toast with an optional action button (e.g. Undo). */
export function toast(msg, action) {
	let el = $('#toast');
	if (!el) {
		el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
		document.body.append(el);
	}
	clear(el);
	el.append(h('span', {}, msg));
	if (action) el.append(h('button', { type: 'button', onclick: () => (action.run(), el.classList.remove('show')) }, action.label));
	el.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2400);
}

export async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
		document.body.append(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	}
}

export function download(filename, content, type = 'text/plain') {
	const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
	const a = h('a', {});
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
