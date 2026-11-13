// store.js - the only module that touches chrome.storage.
//
// v2 kept every task in ONE chrome.storage.sync key. sync allows 8 KB per item, so the log silently
// stopped saving after ~30-50 tasks. v3 keeps tasks in chrome.storage.local (with the
// "unlimitedStorage" permission) and migrates any v2 data on first load.
//
// Every write is read-modify-write against the latest stored value, so the popup, dashboard and
// background worker can all write without clobbering each other.
import { DEFAULT_CATEGORIES, DEFAULT_TICKET_PATTERNS, dedupe, isRunning, migrateLegacy, newTask, normalizeTask, sortTasks } from './model.js';

const K = { tasks: 'qtl.tasks', settings: 'qtl.settings', meta: 'qtl.meta' };

export const DEFAULT_SETTINGS = Object.freeze({
	theme: 'auto', // auto | dark | light | matrix
	historyLimit: 8, // recent entries shown in the popup
	categories: DEFAULT_CATEGORIES,
	defaultCategory: '',
	quickLinks: [],
	ticketPatterns: DEFAULT_TICKET_PATTERNS,
	autoTicket: true, // fill ticket # from the current tab URL
	roundTo: 0, // report rounding in minutes (0, 6, 15...)
	defaultBillable: false,
	reminders: { enabled: false, intervalMin: 60, start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] },
});

const local = () => chrome.storage.local;

async function get(keys) {
	return local().get(keys);
}

/** One-time migration of v2 data out of chrome.storage.sync. Safe to call repeatedly. */
export async function migrate() {
	const meta = (await get(K.meta))[K.meta] || {};
	if (meta.migratedV2) return { migrated: 0 };
	let migrated = 0;
	try {
		const old = await chrome.storage.sync.get(['tasks', 'settings']);
		const cur = (await get(K.tasks))[K.tasks] || [];
		const legacy = migrateLegacy(old.tasks || []);
		migrated = legacy.length;
		const merged = dedupe([...cur.map((t) => normalizeTask(t)), ...legacy]);
		const s = { ...DEFAULT_SETTINGS, ...((await get(K.settings))[K.settings] || {}) };
		if (old.settings) {
			if (Array.isArray(old.settings.categories) && old.settings.categories.length) s.categories = old.settings.categories;
			if (Array.isArray(old.settings.quickLinks)) s.quickLinks = old.settings.quickLinks;
			if (old.settings.theme) s.theme = old.settings.theme;
			if (old.settings.historyLimit) s.historyLimit = Math.min(50, Math.max(1, +old.settings.historyLimit || 8));
		}
		await local().set({ [K.tasks]: merged, [K.settings]: s });
		// v2 data stays in sync storage (untouched) as a safety net; we just never read it again.
	} catch (e) {
		console.warn('[qtl] v2 migration skipped:', e);
	}
	await local().set({ [K.meta]: { ...meta, migratedV2: true, migratedCount: migrated, schema: 3 } });
	return { migrated };
}

export async function loadTasks() {
	return ((await get(K.tasks))[K.tasks] || []).map((t) => normalizeTask(t));
}

export async function loadSettings() {
	const s = (await get(K.settings))[K.settings] || {};
	return {
		...DEFAULT_SETTINGS,
		...s,
		reminders: { ...DEFAULT_SETTINGS.reminders, ...(s.reminders || {}) },
	};
}

export async function saveSettings(patch) {
	const s = await loadSettings();
	const next = { ...s, ...patch };
	await local().set({ [K.settings]: next });
	return next;
}

/** Apply `fn(tasks) -> tasks` against the latest stored list, then persist (sorted newest first). */
export async function mutate(fn) {
	const cur = await loadTasks();
	const next = sortTasks(fn(cur) || cur);
	await local().set({ [K.tasks]: next });
	return next;
}

export async function addTask(fields) {
	const t = newTask(fields);
	await mutate((list) => [t, ...list]);
	return t;
}

export async function updateTask(id, patch) {
	let out = null;
	await mutate((list) =>
		list.map((t) => {
			if (t.id !== id) return t;
			out = normalizeTask({ ...t, ...patch, id: t.id, createdAt: t.createdAt, updatedAt: new Date().toISOString() });
			return out;
		}),
	);
	return out;
}

/** Delete and return the removed task (for undo). */
export async function deleteTask(id) {
	let removed = null;
	await mutate((list) =>
		list.filter((t) => {
			if (t.id === id) removed = t;
			return t.id !== id;
		}),
	);
	return removed;
}

export async function restoreTask(task) {
	await mutate((list) => dedupe([normalizeTask(task), ...list]));
}

export async function importTasks(rawList) {
	const incoming = rawList.map((r) => normalizeTask(r));
	let added = 0;
	await mutate((list) => {
		const merged = dedupe([...list, ...incoming]);
		added = merged.length - list.length;
		return merged;
	});
	return added;
}

export async function clearAll() {
	await local().set({ [K.tasks]: [] });
}

// ------------------------------------------------------------------ timer (one running task at a time)

export const runningTask = (tasks) => tasks.find(isRunning) || null;

/** Stop whatever is running (if anything). Returns the stopped task. */
export async function stopTimer(at = new Date()) {
	let stopped = null;
	await mutate((list) =>
		list.map((t) => {
			if (!isRunning(t)) return t;
			stopped = { ...t, end: at.toISOString(), updatedAt: at.toISOString() };
			return stopped;
		}),
	);
	return stopped;
}

/** Stop the current timer and start a new one. */
export async function startTimer(fields) {
	const now = new Date();
	await stopTimer(now);
	return addTask({ ...fields, durationMin: null, running: true });
}

export function onChange(cb) {
	const h = (changes, area) => {
		if (area !== 'local') return;
		if (changes[K.tasks] || changes[K.settings]) cb(changes);
	};
	chrome.storage.onChanged.addListener(h);
	return () => chrome.storage.onChanged.removeListener(h);
}

export const KEYS = K;
