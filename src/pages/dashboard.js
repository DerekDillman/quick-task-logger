// dashboard.js - Log / Reports / Timesheet / Settings. Hash routing: #log #reports #timesheet #settings #edit=<id>
import { $, $$, applyTheme, clear, copyText, download, h, stamp, toast } from '../lib/dom.js';
import { DEFAULT_TICKET_PATTERNS, detectTicket, isRunning, newTask, normalizeTask, safeLink, taskMinutes } from '../lib/model.js';
import { buildReport, csvRowsToRaw, filterTasks, fromBackup, inRange, parseCSV, reportMarkdown, standup, toBackup, toCSV, toText } from '../lib/report.js';
import * as store from '../lib/store.js';
import { addDays, dayKey, fmtDuration, fmtHours, rangePreset, roundUp, startOfWeek, toLocalInput } from '../lib/time.js';
import { taskRow } from '../lib/ui.js';

let settings;
let tasks = [];
let view = 'log';
let pageSize = 200;
let tsWeek = startOfWeek(new Date());

// ================================================================== boot + routing
init();

async function init() {
	await store.migrate();
	await reload();
	route();
	addEventListener('hashchange', route);
	store.onChange(async () => {
		await reload();
		renderView();
	});
	setInterval(() => tasks.some(isRunning) && renderSideStats(), 30000);
}

async function reload() {
	[settings, tasks] = await Promise.all([store.loadSettings(), store.loadTasks()]);
	applyTheme(settings.theme);
	renderSideStats();
	fillFilterOptions();
}

function route() {
	const hash = location.hash.slice(1);
	if (hash.startsWith('edit=')) {
		const id = decodeURIComponent(hash.slice(5));
		history.replaceState(null, '', '#log');
		view = 'log';
		renderView();
		const t = tasks.find((x) => x.id === id);
		if (t) openEdit(t);
		return;
	}
	view = ['log', 'reports', 'timesheet', 'settings'].includes(hash) ? hash : 'log';
	renderView();
}

function renderView() {
	for (const s of $$('.view')) s.hidden = s.id !== `view-${view}`;
	for (const a of $$('.side nav a')) {
		if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
		else a.removeAttribute('aria-current');
	}
	({ log: renderLog, reports: renderReports, timesheet: renderTimesheet, settings: renderSettings })[view]();
	document.title = `${view[0].toUpperCase()}${view.slice(1)} · Quick Task Logger`;
}

// ================================================================== sidebar
function renderSideStats() {
	const now = new Date();
	const box = clear($('#side-stats'));
	const sum = (from, to) => inRange(tasks, from, to).reduce((s, t) => s + taskMinutes(t, now), 0);
	const td = rangePreset('today', now);
	const wk = rangePreset('week', now);
	const run = tasks.find(isRunning);
	if (run)
		box.append(
			h('div', { class: 'stat run' }, h('b', {}, fmtDuration(taskMinutes(run, now))), h('span', {}, `⏱ ${run.text || 'running'}`)),
		);
	box.append(
		h('div', { class: 'stat' }, h('b', {}, fmtDuration(sum(td.from, td.to))), h('span', {}, 'today')),
		h('div', { class: 'stat' }, h('b', {}, fmtDuration(sum(wk.from, wk.to))), h('span', {}, 'this week')),
	);
}

// ================================================================== LOG
const flt = { q: $('#flt-q'), range: $('#flt-range'), cat: $('#flt-cat'), client: $('#flt-client'), bill: $('#flt-bill') };

function fillFilterOptions() {
	const cats = [...new Set([...settings.categories, ...tasks.map((t) => t.category).filter(Boolean)])];
	const clients = [...new Set(tasks.map((t) => t.client).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	const fill = (sel, first, items) => {
		const keep = sel.value;
		clear(sel).append(h('option', { value: '' }, first), ...items.map((v) => h('option', { value: v }, v)));
		sel.value = items.includes(keep) ? keep : '';
	};
	fill(flt.cat, 'All categories', cats);
	fill(flt.client, 'All clients', clients);
	clear($('#dl-cats')).append(...cats.map((c) => h('option', { value: c })));
	clear($('#dl-clients')).append(...clients.map((c) => h('option', { value: c })));
}

function currentFilter() {
	const r = flt.range.value === 'all' ? null : rangePreset(flt.range.value);
	return { q: flt.q.value, category: flt.cat.value, client: flt.client.value, billable: flt.bill.value, from: r?.from, to: r?.to };
}

function renderLog() {
	const now = new Date();
	const list = filterTasks(tasks, currentFilter());
	const box = clear($('#log-list'));
	const total = list.reduce((s, t) => s + taskMinutes(t, now), 0);
	const bill = list.filter((t) => t.billable).reduce((s, t) => s + taskMinutes(t, now), 0);
	clear($('#log-sum')).append(
		h('span', {}, h('b', {}, String(list.length)), ` of ${tasks.length} entries`),
		h('span', {}, h('b', {}, fmtDuration(total)), ' tracked'),
		bill ? h('span', {}, h('b', {}, fmtDuration(bill)), ' billable') : null,
	);
	if (!list.length) {
		box.append(h('div', { class: 'empty' }, tasks.length ? 'No entries match these filters.' : 'No entries yet. Press N to add one, or use the popup (Ctrl+Shift+L).'));
		$('#more-btn').hidden = true;
		return;
	}
	const shown = list.slice(0, pageSize);
	const byDay = new Map();
	for (const t of shown) byDay.set(dayKey(t.start), [...(byDay.get(dayKey(t.start)) || []), t]);
	for (const [day, items] of byDay) {
		const mins = items.reduce((s, t) => s + taskMinutes(t, now), 0);
		const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
		const dayBox = h('div', { class: 'day' }, h('div', { class: 'day-head' }, h('b', {}, label), h('span', {}, `${items.length} · ${fmtDuration(mins)}`)));
		for (const t of items) {
			const row = taskRow(t, { resume, edit: openEdit, del }, now);
			row.tabIndex = 0;
			row.addEventListener('click', (e) => !e.target.closest('a,button') && openEdit(t));
			row.addEventListener('keydown', (e) => e.key === 'Enter' && openEdit(t));
			dayBox.append(row);
		}
		box.append(dayBox);
	}
	const btn = $('#more-btn');
	btn.hidden = list.length <= pageSize;
	btn.textContent = `Show more (${list.length - pageSize} hidden)`;
}

for (const el of Object.values(flt)) el.addEventListener('input', () => ((pageSize = 200), renderLog()));
$('#more-btn').addEventListener('click', () => ((pageSize += 500), renderLog()));
$('#new-entry').addEventListener('click', () => openEdit(null));
$('#export-csv').addEventListener('click', () => {
	const list = filterTasks(tasks, currentFilter());
	download(`tasks-${stamp()}.csv`, '\uFEFF' + toCSV(list, { roundTo: settings.roundTo }), 'text/csv');
	toast(`Exported ${list.length} entries`);
});
$('#export-txt').addEventListener('click', () => {
	const list = filterTasks(tasks, currentFilter());
	download(`tasks-${stamp()}.txt`, toText(list));
});

async function resume(t) {
	await store.startTimer({ text: t.text, category: t.category, client: t.client, ticket: t.ticket, tags: t.tags, link: t.link, linkTitle: t.linkTitle, billable: t.billable });
	toast('Timer started');
}

async function del(t) {
	const removed = await store.deleteTask(t.id);
	if (removed) toast('Deleted', { label: 'Undo', run: () => store.restoreTask(removed) });
}

// ------------------------------------------------------------------ edit dialog
const dlg = $('#edit');
const e = {
	text: $('#e-text'),
	cat: $('#e-cat'),
	client: $('#e-client'),
	ticket: $('#e-ticket'),
	tags: $('#e-tags'),
	start: $('#e-start'),
	dur: $('#e-dur'),
	link: $('#e-link'),
	notes: $('#e-notes'),
	bill: $('#e-bill'),
};
let editing = null; // task or null (= new)

function openEdit(t) {
	editing = t;
	const src = t || newTask({ category: settings.defaultCategory, billable: settings.defaultBillable });
	$('#edit-title').textContent = t ? 'Edit entry' : 'New entry';
	e.text.value = src.text;
	e.cat.value = src.category;
	e.client.value = src.client;
	e.ticket.value = src.ticket;
	e.tags.value = src.tags.join(' ');
	e.start.value = toLocalInput(src.start);
	e.dur.value = isRunning(src) ? '' : String(taskMinutes(src) || '');
	e.link.value = src.link;
	e.notes.value = src.notes;
	e.bill.checked = src.billable;
	$('#e-running').hidden = !isRunning(src);
	$('#e-del').hidden = !t;
	dlg.showModal();
	e.text.focus();
}

$('#edit-form').addEventListener('submit', async (ev) => {
	if (ev.submitter?.value !== 'save') return;
	const text = e.text.value.trim();
	if (!text) {
		ev.preventDefault();
		return e.text.focus();
	}
	if (e.link.value && !safeLink(e.link.value)) {
		ev.preventDefault();
		return toast('Links must be http(s)');
	}
	const start = new Date(e.start.value);
	const dur = e.dur.value === '' ? null : Math.max(0, Math.round(+e.dur.value));
	const stillRunning = editing && isRunning(editing) && dur === null;
	const fields = {
		text,
		category: e.cat.value.trim(),
		client: e.client.value.trim(),
		ticket: e.ticket.value.trim(),
		tags: e.tags.value.split(/[\s,]+/).filter(Boolean),
		start: start.toISOString(),
		end: stillRunning ? null : new Date(start.getTime() + (dur || 0) * 60000).toISOString(),
		durationMin: stillRunning ? null : dur || 0,
		link: e.link.value.trim(),
		notes: e.notes.value,
		billable: e.bill.checked,
	};
	if (editing) await store.updateTask(editing.id, fields);
	else await store.importTasks([normalizeTask({ ...newTask({}), ...fields })]);
	// remember new categories
	if (fields.category && !settings.categories.includes(fields.category)) await store.saveSettings({ categories: [...settings.categories, fields.category] });
	toast(editing ? 'Saved' : 'Added');
});
$('#e-del').addEventListener('click', async () => {
	if (!editing) return;
	dlg.close();
	await del(editing);
});
dlg.addEventListener('keydown', (ev) => {
	if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
		ev.preventDefault();
		$('#e-save').click();
	}
});

// ================================================================== REPORTS
function reportRange() {
	const r = rangePreset($('#rep-range').value);
	return { ...r, list: inRange(tasks, r.from, r.to) };
}

function bars(box, groups, total) {
	clear(box);
	if (!groups.length) return box.append(h('div', { class: 'muted' }, 'Nothing in this range.'));
	const max = Math.max(...groups.map((g) => g.min), 1);
	for (const g of groups.slice(0, 12))
		box.append(
			h(
				'div',
				{ class: 'bar', title: `${g.count} entries` },
				h('span', { class: 'name' }, g.name),
				h('span', { class: 'track' }, h('span', { class: 'fill', style: { width: `${(g.min / max) * 100}%`, display: 'block' } })),
				h('span', { class: 'val' }, `${fmtDuration(g.min)}${total ? ` · ${Math.round((g.min / total) * 100)}%` : ''}`),
			),
		);
}

function renderReports() {
	const { list, label, from, to } = reportRange();
	const r = buildReport(list, { roundTo: settings.roundTo });
	const days = Math.max(1, new Set(list.map((t) => dayKey(t.start))).size);
	clear($('#rep-cards')).append(
		h('div', { class: 'card' }, h('b', {}, fmtDuration(r.totalMin)), h('span', {}, `tracked · ${fmtHours(r.totalMin, 1)} h`)),
		h('div', { class: 'card' }, h('b', {}, String(r.count)), h('span', {}, 'entries')),
		h('div', { class: 'card' }, h('b', {}, fmtDuration(r.billableMin)), h('span', {}, `billable · ${r.totalMin ? Math.round((r.billableMin / r.totalMin) * 100) : 0}%`)),
		h('div', { class: 'card' }, h('b', {}, fmtDuration(Math.round(r.totalMin / days))), h('span', {}, `avg per active day · ${r.tickets.length} tickets`)),
	);
	bars($('#rep-cat'), r.byCategory, r.totalMin);
	bars(
		$('#rep-client'),
		r.byClient.filter((g) => g.name !== '(none)'),
		r.totalMin,
	);
	// by-day columns (every day in range, including empty ones)
	const cols = clear($('#rep-day'));
	const map = new Map(r.byDay.map((g) => [g.name, g.min]));
	const allDays = [];
	for (let d = new Date(from); d < to; d = addDays(d, 1)) allDays.push(dayKey(d));
	const max = Math.max(...allDays.map((k) => map.get(k) || 0), 1);
	for (const k of allDays) {
		const m = map.get(k) || 0;
		const dt = new Date(`${k}T12:00:00`);
		cols.append(
			h(
				'div',
				{ class: 'col', title: `${dt.toDateString()}: ${fmtDuration(m)}` },
				m ? fmtDuration(m) : '',
				h('div', { class: 'c', style: { height: `${(m / max) * 80}%` } }),
				allDays.length > 10 ? String(dt.getDate()) : dt.toLocaleDateString(undefined, { weekday: 'short' }),
			),
		);
	}
	$('#rep-md').textContent = reportMarkdown([...list].reverse(), { label, roundTo: settings.roundTo });
}
$('#rep-range').addEventListener('input', renderReports);
$('#rep-copy').addEventListener('click', async () => toast((await copyText($('#rep-md').textContent)) ? 'Markdown copied' : 'Copy failed'));
$('#rep-standup').addEventListener('click', async () =>
	toast((await copyText(standup(tasks, { workdays: settings.reminders.days }))) ? 'Standup copied' : 'Copy failed'),
);
$('#rep-csv').addEventListener('click', () => {
	const { list } = reportRange();
	download(`report-${$('#rep-range').value}-${stamp()}.csv`, '\uFEFF' + toCSV(list, { roundTo: settings.roundTo }), 'text/csv');
});

// ================================================================== TIMESHEET
function timesheetData() {
	const groupBy = $('#ts-group').value;
	const days = [...Array(7)].map((_, i) => addDays(tsWeek, i));
	const list = inRange(tasks, tsWeek, addDays(tsWeek, 7));
	const rows = new Map();
	for (const t of list) {
		const key = t[groupBy] || '(none)';
		const r = rows.get(key) || Array(7).fill(0);
		const idx = Math.floor((new Date(dayKey(t.start) + 'T12:00:00') - tsWeek) / 86400000);
		if (idx >= 0 && idx < 7) r[idx] += roundUp(taskMinutes(t), settings.roundTo);
		rows.set(key, r);
	}
	const sorted = [...rows.entries()]
		.filter(([, mins]) => mins.some(Boolean)) // instant notes (0 min) don't belong on a timesheet
		.sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0));
	return { days, rows: sorted, groupBy };
}

function renderTimesheet() {
	const { days, rows, groupBy } = timesheetData();
	const end = addDays(tsWeek, 6);
	$('#ts-label').textContent = `${tsWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
	const today = dayKey(new Date());
	const tbl = clear($('#ts-table'));
	const cls = (d) => (dayKey(d) === today ? 'today' : '');
	tbl.append(
		h(
			'thead',
			{},
			h(
				'tr',
				{},
				h('th', {}, groupBy[0].toUpperCase() + groupBy.slice(1)),
				days.map((d) => h('th', { class: cls(d) }, d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }))),
				h('th', {}, 'Total'),
			),
		),
	);
	const body = h('tbody');
	const colTot = Array(7).fill(0);
	for (const [name, mins] of rows) {
		mins.forEach((m, i) => (colTot[i] += m));
		const tot = mins.reduce((a, b) => a + b, 0);
		body.append(
			h(
				'tr',
				{},
				h('td', { title: name }, name),
				mins.map((m, i) => h('td', { class: `${m ? '' : 'zero'} ${cls(days[i])}` }, m ? fmtHours(m) : '–')),
				h('td', {}, h('b', {}, fmtHours(tot))),
			),
		);
	}
	if (!rows.length) body.append(h('tr', {}, h('td', { colSpan: 9, class: 'muted', style: { textAlign: 'center' } }, 'Nothing logged this week.')));
	tbl.append(body);
	const grand = colTot.reduce((a, b) => a + b, 0);
	tbl.append(h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), colTot.map((m, i) => h('td', { class: cls(days[i]) }, fmtHours(m))), h('td', {}, fmtHours(grand)))));
	$('#ts-note').textContent = `Hours in decimal${settings.roundTo ? `, each entry rounded up to ${settings.roundTo} min` : ''}. Weeks start Monday.`;
}
$('#ts-prev').addEventListener('click', () => ((tsWeek = addDays(tsWeek, -7)), renderTimesheet()));
$('#ts-next').addEventListener('click', () => ((tsWeek = addDays(tsWeek, 7)), renderTimesheet()));
$('#ts-group').addEventListener('input', renderTimesheet);
$('#ts-copy').addEventListener('click', async () => {
	const { days, rows, groupBy } = timesheetData();
	const lines = [[groupBy, ...days.map(dayKey), 'total'].join('\t')];
	for (const [name, mins] of rows) lines.push([name.replace(/\t/g, ' '), ...mins.map((m) => fmtHours(m)), fmtHours(mins.reduce((a, b) => a + b, 0))].join('\t'));
	toast((await copyText(lines.join('\n'))) ? 'Copied: paste into Excel / your timesheet' : 'Copy failed');
});

// ================================================================== SETTINGS
const s = {
	theme: $('#s-theme'),
	history: $('#s-history'),
	defcat: $('#s-defcat'),
	round: $('#s-round'),
	billable: $('#s-billable'),
	autoticket: $('#s-autoticket'),
	cats: $('#s-cats'),
	links: $('#s-links'),
	patterns: $('#s-patterns'),
	rOn: $('#r-on'),
	rInt: $('#r-int'),
	rStart: $('#r-start'),
	rEnd: $('#r-end'),
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let settingsDirty = false;

function renderSettings() {
	if (settingsDirty) return; // don't clobber what the user is typing
	s.theme.value = settings.theme;
	s.history.value = settings.historyLimit;
	clear(s.defcat).append(h('option', { value: '' }, '(none)'), ...settings.categories.map((c) => h('option', { value: c }, c)));
	s.defcat.value = settings.defaultCategory;
	s.round.value = String(settings.roundTo);
	s.billable.checked = settings.defaultBillable;
	s.autoticket.checked = settings.autoTicket;
	s.cats.value = settings.categories.join('\n');
	s.links.value = settings.quickLinks.map((l) => `${l.name} | ${l.url}`).join('\n');
	s.patterns.value = settings.ticketPatterns.map((p) => `${p.name} | ${p.pattern}`).join('\n');
	const r = settings.reminders;
	s.rOn.checked = r.enabled;
	s.rInt.value = String(r.intervalMin);
	s.rStart.value = r.start;
	s.rEnd.value = r.end;
	const days = clear($('#r-days'));
	[1, 2, 3, 4, 5, 6, 0].forEach((d) =>
		days.append(
			h(
				'button',
				{
					type: 'button',
					'aria-pressed': String(r.days.includes(d)),
					onclick: async () => {
						const set = new Set(settings.reminders.days);
						set.has(d) ? set.delete(d) : set.add(d);
						await save({ reminders: { ...settings.reminders, days: [...set] } });
					},
				},
				DAY_NAMES[d],
			),
		),
	);
	const bytes = new Blob([JSON.stringify(tasks)]).size;
	$('#data-info').textContent = `${tasks.length} entries · ${(bytes / 1024).toFixed(1)} KB in local storage${tasks.length ? ` · oldest ${new Date(tasks[tasks.length - 1].start).toLocaleDateString()}` : ''}.`;
	testPattern();
}

async function save(patch) {
	settings = await store.saveSettings(patch);
	$('#save-state').textContent = `Saved ${new Date().toLocaleTimeString()}`;
	applyTheme(settings.theme);
}

const parsePairs = (text, keyA, keyB) =>
	text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => {
			const i = l.indexOf('|');
			return i < 0 ? null : { [keyA]: l.slice(0, i).trim(), [keyB]: l.slice(i + 1).trim() };
		})
		.filter((x) => x && x[keyA] && x[keyB]);

const savers = {
	theme: () => save({ theme: s.theme.value }),
	history: () => save({ historyLimit: Math.min(50, Math.max(1, Math.round(+s.history.value) || 8)) }),
	defcat: () => save({ defaultCategory: s.defcat.value }),
	round: () => save({ roundTo: +s.round.value }),
	billable: () => save({ defaultBillable: s.billable.checked }),
	autoticket: () => save({ autoTicket: s.autoticket.checked }),
	cats: () => save({ categories: [...new Set(s.cats.value.split('\n').map((c) => c.trim()).filter(Boolean))].slice(0, 40) }),
	links: () => save({ quickLinks: parsePairs(s.links.value, 'name', 'url').filter((l) => safeLink(l.url)).map((l) => ({ ...l, url: safeLink(l.url) })) }),
	patterns: () => {
		const list = parsePairs(s.patterns.value, 'name', 'pattern');
		const bad = list.filter((p) => {
			try {
				new RegExp(p.pattern);
				return false;
			} catch {
				return true;
			}
		});
		if (bad.length) toast(`Invalid regex: ${bad.map((b) => b.name).join(', ')} (skipped)`);
		return save({ ticketPatterns: list.length ? list.filter((p) => !bad.includes(p)) : DEFAULT_TICKET_PATTERNS });
	},
	rOn: () => save({ reminders: { ...settings.reminders, enabled: s.rOn.checked } }),
	rInt: () => save({ reminders: { ...settings.reminders, intervalMin: +s.rInt.value } }),
	rStart: () => save({ reminders: { ...settings.reminders, start: s.rStart.value || '08:00' } }),
	rEnd: () => save({ reminders: { ...settings.reminders, end: s.rEnd.value || '17:00' } }),
};
for (const [k, el] of Object.entries(s)) {
	const isText = el.tagName === 'TEXTAREA';
	el.addEventListener(isText ? 'input' : 'change', () => {
		settingsDirty = isText;
		clearTimeout(el._t);
		el._t = setTimeout(
			async () => {
				await savers[k]();
				settingsDirty = false;
			},
			isText ? 600 : 0,
		);
	});
	if (isText) el.addEventListener('blur', () => (settingsDirty = false));
}

function testPattern() {
	const url = $('#pat-test').value.trim();
	$('#pat-out').textContent = url ? detectTicket(url, settings.ticketPatterns) || 'no match' : '';
}
$('#pat-test').addEventListener('input', testPattern);

$('#backup').addEventListener('click', () => {
	download(`quick-task-logger-backup-${stamp()}.json`, toBackup(tasks, settings), 'application/json');
	toast(`Backed up ${tasks.length} entries`);
});
$('#import').addEventListener('change', async (ev) => {
	const file = ev.target.files[0];
	ev.target.value = '';
	if (!file) return;
	try {
		if (file.size > 50 * 1024 * 1024) throw new Error('File is larger than 50 MB');
		const text = await file.text();
		let raw;
		if (/\.csv$/i.test(file.name) || file.type === 'text/csv') raw = csvRowsToRaw(parseCSV(text));
		else raw = fromBackup(text).tasks;
		const added = await store.importTasks(raw);
		toast(`Imported ${added} new entries (${raw.length - added} duplicates skipped)`);
	} catch (err) {
		toast(`Import failed: ${err.message}`);
	}
});
$('#clear').addEventListener('click', async () => {
	const n = tasks.length;
	if (!n) return toast('Nothing to delete');
	const typed = prompt(`This permanently deletes all ${n} entries.\nTip: click "Backup (JSON)" first.\n\nType DELETE to confirm:`);
	if (typed !== 'DELETE') return toast('Cancelled');
	const snapshot = tasks;
	await store.clearAll();
	toast(`Deleted ${n} entries`, { label: 'Undo', run: () => store.importTasks(snapshot) });
});

// ================================================================== global keys
document.addEventListener('keydown', (ev) => {
	if (dlg.open || ev.ctrlKey || ev.metaKey || ev.altKey) return;
	const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
	if (typing) return;
	if (ev.key === '/') {
		ev.preventDefault();
		location.hash = '#log';
		flt.q.focus();
	} else if (ev.key.toLowerCase() === 'n') {
		ev.preventDefault();
		openEdit(null);
	}
});
