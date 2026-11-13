// model.js - task shape, legacy (v2) migration, link safety, ticket detection. Pure, unit-testable.
//
// Task (v3):
//   id          string   stable id
//   text        string   what was done
//   category    string
//   client      string   client / company / department (v2: "company")
//   ticket      string
//   notes       string
//   link        string   http(s) only
//   linkTitle   string
//   tags        string[]
//   start       ISO      when work started (v2: "timestamp")
//   end         ISO|null null = timer still running
//   durationMin number|null  explicit minutes; null = derive from start/end (or 0 for instant notes)
//   billable    boolean
//   createdAt / updatedAt ISO

export const SCHEMA_VERSION = 3;

export const DEFAULT_CATEGORIES = [
	'Break/Fix',
	'Administration',
	'Network',
	'Maintenance',
	'Support',
	'Security',
	'Project',
	'Meeting',
	'Documentation',
];

/** Ticket URL patterns: one capture group = the ticket id. Users can add their own in Settings. */
export const DEFAULT_TICKET_PATTERNS = [
	{ name: 'Freshservice / Freshdesk', pattern: '/(?:helpdesk|a)/tickets/(\\d+)' },
	{ name: 'ServiceDesk Plus', pattern: '[?&]woID=(\\d+)' },
	{ name: 'Zendesk', pattern: '/agent/tickets/(\\d+)' },
	{ name: 'ConnectWise Manage', pattern: '[?&]recid=(\\d+)' },
	{ name: 'Autotask', pattern: '[?&]ticketI[dD]=(\\d+)' },
	{ name: 'HaloPSA', pattern: '/tickets\\?id=(\\d+)' },
	{ name: 'Jira', pattern: '/browse/([A-Z][A-Z0-9]+-\\d+)' },
	{ name: 'ServiceNow', pattern: '[?&]sysparm_query=number=([A-Z]+\\d+)|(INC\\d{6,}|RITM\\d{6,}|CHG\\d{6,})' },
	{ name: 'GitHub / GitLab issue', pattern: '/(?:issues|pull|merge_requests)/(\\d+)' },
];

export const uid = () =>
	globalThis.crypto?.randomUUID?.() ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Only http(s) links survive. Blocks javascript:, data:, file: etc. */
export function safeLink(url) {
	const s = String(url || '').trim();
	if (!s) return '';
	try {
		const u = new URL(s);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
	} catch {
		return '';
	}
}

const str = (v, max = 5000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const iso = (v) => {
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Coerce anything (v2 task, v3 task, CSV row, imported JSON) into a valid v3 task. */
export function normalizeTask(raw, now = new Date()) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const start = iso(r.start ?? r.timestamp ?? r.createdAt) ?? now.toISOString();
	const end = r.end === null ? null : iso(r.end) ?? (r.running ? null : start);
	let durationMin = r.durationMin ?? r.duration ?? null;
	durationMin = durationMin === null || durationMin === '' ? null : Math.max(0, Math.round(Number(durationMin) || 0));
	return {
		id: str(r.id, 80) || uid(),
		text: str(r.text, 2000).trim(),
		category: str(r.category, 80).trim(),
		client: str(r.client ?? r.company, 120).trim(),
		ticket: str(r.ticket, 80).trim(),
		notes: str(r.notes, 10000),
		link: safeLink(r.link),
		linkTitle: str(r.linkTitle, 300),
		tags: Array.isArray(r.tags) ? [...new Set(r.tags.map((t) => str(t, 40).trim().toLowerCase()).filter(Boolean))] : [],
		start,
		end,
		durationMin,
		billable: Boolean(r.billable),
		createdAt: iso(r.createdAt) ?? start,
		updatedAt: iso(r.updatedAt) ?? now.toISOString(),
	};
}

/** Build a new task from a quick-entry parse (or form fields). Duration = work already done, ending now. */
export function newTask(fields = {}, now = new Date()) {
	const dur = fields.durationMin ? Math.max(0, Math.round(fields.durationMin)) : null;
	const end = fields.running ? null : now;
	const start = fields.start ? new Date(fields.start) : dur ? new Date(now.getTime() - dur * 60000) : now;
	return normalizeTask(
		{
			...fields,
			id: uid(),
			start: start.toISOString(),
			end: end ? end.toISOString() : null,
			durationMin: fields.running ? null : dur,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		},
		now,
	);
}

/** Minutes of work for a task. Running timers count up to `now`. */
export function taskMinutes(t, now = new Date()) {
	if (t.durationMin !== null && t.durationMin !== undefined) return t.durationMin;
	const s = new Date(t.start).getTime();
	const e = t.end ? new Date(t.end).getTime() : now.getTime();
	return Math.max(0, Math.round((e - s) / 60000));
}

export const isRunning = (t) => t && t.end === null;

/** Migrate a v2 task array (chrome.storage.sync "tasks") into v3 tasks, newest first, deduped. */
export function migrateLegacy(list, now = new Date()) {
	if (!Array.isArray(list)) return [];
	return dedupe(list.map((t) => normalizeTask(t, now)));
}

/** Merge task lists by id (and by start+text for legacy items without ids). Newest first. */
export function dedupe(tasks) {
	const seen = new Set();
	const out = [];
	for (const t of tasks) {
		const k1 = t.id;
		const k2 = `${t.start}|${t.text}`;
		if (seen.has(k1) || seen.has(k2)) continue;
		seen.add(k1);
		seen.add(k2);
		out.push(t);
	}
	return sortTasks(out);
}

export const sortTasks = (tasks) => [...tasks].sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));

/** Find a ticket id in a URL using the configured patterns. Bad user regexes are skipped, not fatal. */
export function detectTicket(url, patterns = DEFAULT_TICKET_PATTERNS) {
	if (!url) return '';
	for (const p of patterns) {
		let re;
		try {
			re = new RegExp(p.pattern, 'i');
		} catch {
			continue;
		}
		const m = String(url).match(re);
		if (m) {
			const id = m.slice(1).find(Boolean);
			if (id) return id;
		}
	}
	return '';
}
