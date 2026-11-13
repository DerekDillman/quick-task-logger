// popup.js - the 2-second logging surface.
//   Enter          log (a duration like "45m" logs time already spent)
//   Ctrl+Enter     start a timer (stops any running one)
//   Shift+Enter    newline
//   Esc            close
import { $, applyTheme, clear, copyText, h, toast } from '../lib/dom.js';
import { describeParse, parseQuick } from '../lib/parse.js';
import { detectTicket, isRunning, taskMinutes } from '../lib/model.js';
import { standup } from '../lib/report.js';
import * as store from '../lib/store.js';
import { dayKey, fmtClock, fmtDuration } from '../lib/time.js';
import { metaChips, taskRow } from '../lib/ui.js';

const isWindow = new URLSearchParams(location.search).has('window');
if (isWindow) document.documentElement.classList.add('window');

const DASH = chrome.runtime.getURL('src/pages/dashboard.html');
const DRAFT_KEY = 'qtl.draft';

let settings;
let tasks = [];
let pickedCategory = '';
let tab = null; // { url, title } of the page the popup was opened over
let clockTimer = 0;

const q = $('#q');
const f = {
	client: $('#f-client'),
	ticket: $('#f-ticket'),
	notes: $('#f-notes'),
	link: $('#f-link'),
	billable: $('#f-billable'),
};

// ------------------------------------------------------------------ boot
init();

async function init() {
	await store.migrate();
	[settings, tasks] = await Promise.all([store.loadSettings(), store.loadTasks()]);
	applyTheme(settings.theme);
	f.billable.checked = settings.defaultBillable;
	pickedCategory = settings.defaultCategory || '';
	renderCats();
	renderClients();
	renderQuickLinks();
	await restoreDraft();
	await readTab();
	render();
	updatePreview();
	q.focus();
	store.onChange(async () => {
		[settings, tasks] = await Promise.all([store.loadSettings(), store.loadTasks()]);
		render();
	});
}

/** The tab under the popup (activeTab grants url/title only when opened from the toolbar/shortcut). */
async function readTab() {
	try {
		const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		if (t?.url && /^https?:/i.test(t.url)) tab = { url: t.url, title: t.title || '' };
	} catch {
		tab = null;
	}
	$('#attach').hidden = !tab;
	if (tab && settings.autoTicket && !f.ticket.value) {
		const id = detectTicket(tab.url, settings.ticketPatterns);
		if (id) {
			f.ticket.value = id;
			f.ticket.dataset.auto = '1';
			f.link.value ||= tab.url;
			toast(`Ticket ${id} detected from this tab`);
		}
	}
	updateMoreSummary();
}

// ------------------------------------------------------------------ draft (survives closing the popup)
async function restoreDraft() {
	try {
		const d = (await chrome.storage.session.get(DRAFT_KEY))[DRAFT_KEY];
		if (!d) return;
		q.value = d.q || '';
		for (const k of ['client', 'ticket', 'notes', 'link']) f[k].value = d[k] || '';
		if (d.category) pickedCategory = d.category;
		if (typeof d.billable === 'boolean') f.billable.checked = d.billable;
		if (d.client || d.ticket || d.notes || d.link) $('#more').open = true;
		renderCats();
	} catch {
		/* session storage unavailable: no drafts */
	}
}
let draftTimer = 0;
function saveDraft() {
	clearTimeout(draftTimer);
	draftTimer = setTimeout(() => {
		const d = { q: q.value, category: pickedCategory, billable: f.billable.checked };
		for (const k of ['client', 'ticket', 'notes', 'link']) d[k] = f[k].value;
		chrome.storage.session?.set({ [DRAFT_KEY]: d }).catch(() => {});
	}, 200);
}
const clearDraft = () => chrome.storage.session?.remove(DRAFT_KEY).catch(() => {});

// ------------------------------------------------------------------ rendering
function render() {
	const now = new Date();
	const today = dayKey(now);
	const todays = tasks.filter((t) => dayKey(t.start) === today);
	const total = todays.reduce((s, t) => s + taskMinutes(t, now), 0);
	$('#today').textContent = todays.length ? `Today ${fmtDuration(total)} · ${todays.length}` : 'Nothing logged today';

	renderRunning(tasks.find(isRunning));

	const list = clear($('#list'));
	const recent = tasks.filter((t) => !isRunning(t)).slice(0, settings.historyLimit);
	$('#recent-count').textContent = tasks.length ? `${tasks.length} total` : '';
	if (!recent.length) {
		list.append(
			h('div', { class: 'empty' }, 'No entries yet. Type what you did and press ', h('kbd', {}, 'Enter'), '.', h('br'), 'Tip: type ', h('kbd', {}, 'tl'), ' + space in the address bar to log from anywhere.'),
		);
		return;
	}
	for (const t of recent) list.append(taskRow(t, { resume, edit, del }, now));
}

function renderRunning(run) {
	const box = $('#running');
	clearInterval(clockTimer);
	if (!run) {
		box.hidden = true;
		return;
	}
	box.hidden = false;
	clear(box);
	const clock = h('div', { class: 'r-clock' });
	const tick = () => (clock.textContent = fmtClock(Date.now() - new Date(run.start).getTime()));
	tick();
	clockTimer = setInterval(tick, 1000);
	box.append(
		h('div', { class: 'r-text' }, run.text || 'Timer running'),
		clock,
		h('div', { class: 't-meta', style: { gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '4px' } }, metaChips(run)),
		h(
			'div',
			{ class: 'r-btns' },
			h('button', { class: 'btn primary sm', type: 'button', onclick: stop, title: 'Alt+Shift+K' }, '■ Stop'),
			h('button', { class: 'btn sm', type: 'button', onclick: () => edit(run) }, '✎ Edit'),
			h('button', { class: 'btn sm danger', type: 'button', onclick: () => del(run) }, 'Discard'),
		),
	);
}

function renderCats() {
	const box = clear($('#cats'));
	for (const c of settings.categories) {
		box.append(
			h(
				'button',
				{
					type: 'button',
					'aria-pressed': String(c === pickedCategory),
					onclick: () => {
						pickedCategory = pickedCategory === c ? '' : c;
						renderCats();
						updatePreview();
						saveDraft();
						q.focus();
					},
				},
				c,
			),
		);
	}
}

function renderClients() {
	const dl = clear($('#clients'));
	const seen = new Map();
	for (const t of tasks) if (t.client) seen.set(t.client, (seen.get(t.client) || 0) + 1);
	[...seen.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 50)
		.forEach(([c]) => dl.append(h('option', { value: c })));
}

function renderQuickLinks() {
	const sel = $('#quick-links');
	clear(sel);
	if (!settings.quickLinks?.length) return (sel.hidden = true);
	sel.hidden = false;
	sel.append(h('option', { value: '' }, 'Quick links…'));
	for (const l of settings.quickLinks) sel.append(h('option', { value: l.url }, l.name));
	sel.onchange = () => {
		if (sel.value) f.link.value = sel.value;
		sel.value = '';
		updateMoreSummary();
		saveDraft();
	};
}

function currentFields() {
	const p = parseQuick(q.value, settings.categories);
	return {
		...p,
		category: p.category || pickedCategory || settings.defaultCategory,
		client: p.client || f.client.value.trim(),
		ticket: p.ticket || f.ticket.value.trim(),
		notes: f.notes.value.trim(),
		link: p.link || f.link.value.trim(),
		linkTitle: tab && (p.link || f.link.value.trim()) === tab.url ? tab.title : '',
		billable: p.billable || f.billable.checked,
	};
}

function updatePreview() {
	const p = parseQuick(q.value, settings.categories);
	const box = clear($('#preview'));
	if (!q.value.trim()) return;
	const meta = describeParse(p);
	if (meta) box.append(...meta.split('  ').map((m) => h('span', { class: 'chip cat' }, m)));
	if (p.category && p.category !== pickedCategory && !settings.categories.includes(p.category)) box.append(h('span', { class: 'chip' }, 'new category'));
}

function updateMoreSummary() {
	const bits = [f.client.value && `@${f.client.value}`, f.ticket.value && `#${f.ticket.value}`, f.link.value && 'link', f.notes.value && 'notes'].filter(Boolean);
	$('#more-sum').textContent = bits.length ? `· ${bits.join(' ')}` : '';
}

// ------------------------------------------------------------------ actions
async function log() {
	const fields = currentFields();
	if (!fields.text) {
		q.focus();
		return toast('Type what you worked on first');
	}
	const t = await store.addTask(fields);
	resetForm();
	toast(`Logged${t.durationMin ? ` ${fmtDuration(t.durationMin)}` : ''}`, { label: 'Undo', run: () => store.deleteTask(t.id) });
}

async function start() {
	const fields = currentFields();
	if (!fields.text) {
		q.focus();
		return toast('Name the task, then Ctrl+Enter to start the clock');
	}
	await store.startTimer(fields);
	resetForm();
	toast('Timer started');
}

async function stop() {
	const t = await store.stopTimer();
	if (t) toast(`Stopped: ${fmtDuration(taskMinutes(t))}`);
}

async function resume(t) {
	await store.startTimer({ text: t.text, category: t.category, client: t.client, ticket: t.ticket, tags: t.tags, link: t.link, linkTitle: t.linkTitle, billable: t.billable });
	toast('Timer started');
}

function edit(t) {
	chrome.tabs.create({ url: `${DASH}#edit=${encodeURIComponent(t.id)}` });
	if (!isWindow) window.close();
}

async function del(t) {
	const removed = await store.deleteTask(t.id);
	if (removed) toast('Deleted', { label: 'Undo', run: () => store.restoreTask(removed) });
}

function resetForm() {
	q.value = '';
	for (const k of ['client', 'ticket', 'notes', 'link']) f[k].value = '';
	delete f.ticket.dataset.auto;
	f.billable.checked = settings.defaultBillable;
	$('#more').open = false;
	updatePreview();
	updateMoreSummary();
	clearDraft();
	q.focus();
}

// ------------------------------------------------------------------ wiring
q.addEventListener('input', () => {
	updatePreview();
	saveDraft();
});
q.addEventListener('keydown', (e) => {
	if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
	e.preventDefault();
	(e.ctrlKey || e.metaKey ? start : log)();
});
for (const el of Object.values(f)) {
	el.addEventListener('input', () => {
		updateMoreSummary();
		saveDraft();
	});
	if (el.tagName === 'INPUT' && el.type !== 'checkbox')
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				(e.ctrlKey || e.metaKey ? start : log)();
			}
		});
}
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && !isWindow) window.close();
});
$('#log').addEventListener('click', log);
$('#start').addEventListener('click', start);
$('#attach').addEventListener('click', () => {
	if (!tab) return;
	f.link.value = tab.url;
	const id = settings.autoTicket ? detectTicket(tab.url, settings.ticketPatterns) : '';
	if (id && !f.ticket.value) f.ticket.value = id;
	if (!q.value.trim()) q.value = tab.title;
	updatePreview();
	updateMoreSummary();
	saveDraft();
	q.focus();
});
$('#open-dash').addEventListener('click', () => chrome.tabs.create({ url: DASH }));
$('#open-report').addEventListener('click', () => chrome.tabs.create({ url: `${DASH}#reports` }));
$('#open-settings').addEventListener('click', () => chrome.tabs.create({ url: `${DASH}#settings` }));
$('#copy-standup').addEventListener('click', async () => {
	const ok = await copyText(standup(tasks, { workdays: settings.reminders.days }));
	toast(ok ? 'Standup copied to clipboard' : 'Copy failed');
});
