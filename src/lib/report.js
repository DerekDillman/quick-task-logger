// report.js - exports, imports and reports. Pure functions (unit-tested in Node).
import { taskMinutes } from './model.js';
import { dayKey, fmtDuration, fmtHours, fmtTime, previousWorkday, roundUp, startOfDay, addDays } from './time.js';

// ------------------------------------------------------------------ CSV (RFC 4180)

export const CSV_COLUMNS = [
	'date',
	'start',
	'end',
	'minutes',
	'hours',
	'category',
	'client',
	'ticket',
	'text',
	'notes',
	'link',
	'tags',
	'billable',
	'id',
];

/** Quote a CSV cell. Also neutralizes spreadsheet formula injection (=, +, -, @ at the start). */
export function csvCell(v) {
	let s = v == null ? '' : String(v);
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(tasks, { now = new Date(), roundTo = 0 } = {}) {
	const rows = [CSV_COLUMNS.join(',')];
	for (const t of tasks) {
		const min = roundUp(taskMinutes(t, now), roundTo);
		rows.push(
			[
				dayKey(t.start),
				fmtTime(t.start),
				t.end ? fmtTime(t.end) : '',
				min,
				fmtHours(min),
				t.category,
				t.client,
				t.ticket,
				t.text,
				t.notes,
				t.link,
				t.tags.join(' '),
				t.billable ? 'yes' : '',
				t.id,
			]
				.map(csvCell)
				.join(','),
		);
	}
	return rows.join('\r\n') + '\r\n';
}

/** Parse CSV text into an array of objects keyed by the header row. Handles quotes, CRLF, embedded newlines. */
export function parseCSV(text) {
	const rows = [];
	let row = [];
	let cell = '';
	let q = false;
	const s = String(text || '').replace(/^\uFEFF/, '');
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (q) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					cell += '"';
					i++;
				} else q = false;
			} else cell += c;
		} else if (c === '"') q = true;
		else if (c === ',') {
			row.push(cell);
			cell = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && s[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += c;
	}
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	const [head, ...body] = rows.filter((r) => r.some((c) => c !== ''));
	if (!head) return [];
	const keys = head.map((h) => h.trim().toLowerCase());
	return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

/** Turn parsed CSV rows (our export, or the v2 export "Date,Time,Category,Task,...") into raw task objects. */
export function csvRowsToRaw(rows) {
	return rows.map((r) => {
		const unq = (v) => String(v ?? '').replace(/^'(?=[=+\-@])/, '');
		const date = r.date || '';
		const startT = r.start || r.time || '00:00';
		const start = new Date(`${date} ${startT}`);
		const minutes = r.minutes !== undefined && r.minutes !== '' ? Number(r.minutes) : null;
		const end = r.end ? new Date(`${date} ${r.end}`) : null;
		return {
			id: r.id || undefined,
			text: unq(r.text ?? r.task),
			category: unq(r.category),
			client: unq(r.client ?? r.company),
			ticket: unq(r.ticket),
			notes: unq(r.notes),
			link: r.link,
			tags: String(r.tags || '').split(/\s+/).filter(Boolean),
			start: Number.isNaN(start.getTime()) ? undefined : start.toISOString(),
			end: end && !Number.isNaN(end.getTime()) ? end.toISOString() : undefined,
			durationMin: minutes,
			billable: /^(yes|true|1|y)$/i.test(r.billable || ''),
		};
	});
}

// ------------------------------------------------------------------ JSON backup

export function toBackup(tasks, settings, now = new Date()) {
	return JSON.stringify({ app: 'quick-task-logger', schema: 3, exportedAt: now.toISOString(), settings, tasks }, null, 2);
}

/** Accepts our backup format, a bare task array, or a v2 {tasks:[...]} dump. */
export function fromBackup(text) {
	const data = JSON.parse(text);
	if (Array.isArray(data)) return { tasks: data, settings: null };
	if (data && Array.isArray(data.tasks)) return { tasks: data.tasks, settings: data.settings ?? null };
	throw new Error('Not a Quick Task Logger backup (no "tasks" array found).');
}

// ------------------------------------------------------------------ filtering

/** Tasks whose start is in [from, to). */
export const inRange = (tasks, from, to) => tasks.filter((t) => new Date(t.start) >= from && new Date(t.start) < to);

export function filterTasks(tasks, f = {}) {
	const q = (f.q || '').trim().toLowerCase();
	return tasks.filter((t) => {
		if (f.category && t.category !== f.category) return false;
		if (f.client && t.client !== f.client) return false;
		if (f.billable === 'yes' && !t.billable) return false;
		if (f.billable === 'no' && t.billable) return false;
		if (f.from && new Date(t.start) < f.from) return false;
		if (f.to && new Date(t.start) >= f.to) return false;
		if (q) {
			const hay = [t.text, t.notes, t.client, t.ticket, t.category, t.link, t.tags.join(' ')].join(' ').toLowerCase();
			if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
		}
		return true;
	});
}

// ------------------------------------------------------------------ reports

function groupMinutes(tasks, keyFn, now, roundTo) {
	const m = new Map();
	for (const t of tasks) {
		const k = keyFn(t) || '(none)';
		const g = m.get(k) || { name: k, min: 0, count: 0 };
		g.min += roundUp(taskMinutes(t, now), roundTo);
		g.count++;
		m.set(k, g);
	}
	return [...m.values()].sort((a, b) => b.min - a.min || b.count - a.count);
}

export function buildReport(tasks, { now = new Date(), roundTo = 0 } = {}) {
	const total = tasks.reduce((s, t) => s + roundUp(taskMinutes(t, now), roundTo), 0);
	const billable = tasks.filter((t) => t.billable).reduce((s, t) => s + roundUp(taskMinutes(t, now), roundTo), 0);
	return {
		count: tasks.length,
		totalMin: total,
		billableMin: billable,
		byCategory: groupMinutes(tasks, (t) => t.category, now, roundTo),
		byClient: groupMinutes(tasks, (t) => t.client, now, roundTo),
		byDay: groupMinutes(tasks, (t) => dayKey(t.start), now, roundTo).sort((a, b) => (a.name < b.name ? -1 : 1)),
		tickets: [...new Set(tasks.map((t) => t.ticket).filter(Boolean))],
	};
}

const bullet = (t) => {
	const meta = [t.client && `@${t.client}`, t.ticket && `#${t.ticket}`].filter(Boolean).join(' ');
	return `- ${t.text || '(no description)'}${meta ? ` (${meta})` : ''}`;
};

/** Markdown summary for a manager / timesheet / Teams post. */
export function reportMarkdown(tasks, { label = 'Report', now = new Date(), roundTo = 0 } = {}) {
	const r = buildReport(tasks, { now, roundTo });
	const lines = [`## Work summary: ${label}`, ''];
	lines.push(`**${r.count} entries · ${fmtDuration(r.totalMin)} tracked**${r.billableMin ? ` · ${fmtDuration(r.billableMin)} billable` : ''}`, '');
	if (r.byCategory.length) {
		lines.push('### By category', '');
		for (const g of r.byCategory) lines.push(`- ${g.name}: ${fmtDuration(g.min)} (${g.count})`);
		lines.push('');
	}
	const clients = r.byClient.filter((g) => g.name !== '(none)');
	if (clients.length) {
		lines.push('### By client', '');
		for (const g of clients) lines.push(`- ${g.name}: ${fmtDuration(g.min)} (${g.count})`);
		lines.push('');
	}
	lines.push('### Highlights', '');
	const byCat = new Map();
	for (const t of tasks) byCat.set(t.category || 'Other', [...(byCat.get(t.category || 'Other') || []), t]);
	for (const [cat, list] of byCat) {
		lines.push(`**${cat}**`);
		for (const t of list.slice(0, 12)) lines.push(bullet(t));
		if (list.length > 12) lines.push(`- …and ${list.length - 12} more`);
		lines.push('');
	}
	return lines.join('\n').trim() + '\n';
}

/** Daily standup: what I did on the previous workday + what's logged today so far. */
export function standup(tasks, { now = new Date(), workdays = [1, 2, 3, 4, 5] } = {}) {
	const prev = previousWorkday(now, workdays);
	const today = startOfDay(now);
	const y = inRange(tasks, prev, addDays(prev, 1)).reverse();
	const t = inRange(tasks, today, addDays(today, 1)).reverse();
	const isYesterday = dayKey(prev) === dayKey(addDays(today, -1));
	const out = [`**${isYesterday ? 'Yesterday' : prev.toLocaleDateString(undefined, { weekday: 'long' })}**`];
	out.push(...(y.length ? y.map(bullet) : ['- (nothing logged)']));
	out.push('', '**Today**');
	out.push(...(t.length ? t.map(bullet) : ['- (nothing logged yet)']));
	out.push('', '**Blockers**', '- none');
	return out.join('\n') + '\n';
}

/** Plain-text day log (the v2 "Export TXT", improved). */
export function toText(tasks, now = new Date()) {
	return tasks
		.map((t) => {
			const head = `${dayKey(t.start)} ${fmtTime(t.start)}  [${t.category || 'Uncategorized'}] ${t.text}`;
			const meta = [
				`${fmtDuration(taskMinutes(t, now))}`,
				t.client && `client: ${t.client}`,
				t.ticket && `ticket: ${t.ticket}`,
				t.billable && 'billable',
			].filter(Boolean);
			return [head, `  ${meta.join(' | ')}`, t.notes && `  notes: ${t.notes}`, t.link && `  link: ${t.link}`].filter(Boolean).join('\n');
		})
		.join('\n\n');
}
