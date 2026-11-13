// background.js - MV3 service worker (ES module).
//   - v2 -> v3 data migration on install/update
//   - toolbar badge: live timer minutes (or today's entry count)
//   - omnibox:  type "tl <quick entry>" in the address bar to log without opening anything
//   - context menu: log selected text / the current page (ticket # auto-detected from the URL)
//   - keyboard commands: stop timer, open dashboard
//   - optional "what are you working on?" reminders during work hours
import { describeParse, parseQuick } from './lib/parse.js';
import { detectTicket, isRunning, taskMinutes } from './lib/model.js';
import { addTask, loadSettings, loadTasks, migrate, onChange, runningTask, stopTimer } from './lib/store.js';
import { dayKey, fmtDuration } from './lib/time.js';

const ICON = chrome.runtime.getURL('icons/icon128.png');
const POPUP_WINDOW = chrome.runtime.getURL('src/pages/popup.html?window=1');
const DASHBOARD = chrome.runtime.getURL('src/pages/dashboard.html');

// ------------------------------------------------------------------ install / startup
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
	const { migrated } = await migrate();
	setupMenus();
	await refresh();
	if (reason === 'install' || (reason === 'update' && migrated > 0)) {
		notify('qtl-welcome', 'Quick Task Logger 3', migrated ? `Upgraded: ${migrated} existing entries moved to unlimited local storage.` : 'Press Ctrl+Shift+L to log, or type "tl" + space in the address bar.');
	}
});
chrome.runtime.onStartup.addListener(async () => {
	await migrate();
	await refresh();
});

function setupMenus() {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({ id: 'log-selection', title: 'Log "%s" as a task', contexts: ['selection'] });
		chrome.contextMenus.create({ id: 'log-page', title: 'Log this page as a task', contexts: ['page', 'frame'] });
		chrome.contextMenus.create({ id: 'log-link', title: 'Log this link as a task', contexts: ['link'] });
	});
}

// ------------------------------------------------------------------ badge + alarms
async function refresh() {
	const [tasks, settings] = await Promise.all([loadTasks(), loadSettings()]);
	const run = runningTask(tasks);
	if (run) {
		const m = taskMinutes(run);
		await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
		await chrome.action.setBadgeText({ text: m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`.slice(0, 4) });
		await chrome.action.setTitle({ title: `⏱ ${run.text || 'Timer'} - ${fmtDuration(m)} (Alt+Shift+K to stop)` });
		const a = await chrome.alarms.get('tick');
		if (!a) chrome.alarms.create('tick', { periodInMinutes: 1 });
	} else {
		const today = dayKey(new Date());
		const n = tasks.filter((t) => dayKey(t.start) === today).length;
		await chrome.action.setBadgeBackgroundColor({ color: '#3c4043' });
		await chrome.action.setBadgeText({ text: n ? String(n) : '' });
		await chrome.action.setTitle({ title: `Quick Task Logger - ${n} today (Ctrl+Shift+L)` });
		chrome.alarms.clear('tick');
	}
	// reminders
	const r = settings.reminders;
	const cur = await chrome.alarms.get('nudge');
	if (r.enabled) {
		if (!cur || cur.periodInMinutes !== r.intervalMin) chrome.alarms.create('nudge', { periodInMinutes: Math.max(15, r.intervalMin) });
	} else if (cur) chrome.alarms.clear('nudge');
}

onChange(() => refresh());

chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === 'tick') return refresh();
	if (alarm.name === 'nudge') return maybeNudge();
	if (alarm.name === 'snooze-end') return maybeNudge(true);
});

const toMin = (hhmm) => {
	const [h, m] = String(hhmm || '0:0').split(':').map(Number);
	return (h || 0) * 60 + (m || 0);
};

async function maybeNudge(force = false) {
	const [tasks, s] = await Promise.all([loadTasks(), loadSettings()]);
	const r = s.reminders;
	if (!r.enabled) return;
	const now = new Date();
	const mins = now.getHours() * 60 + now.getMinutes();
	if (!r.days.includes(now.getDay()) || mins < toMin(r.start) || mins > toMin(r.end)) return;
	if (tasks.some(isRunning)) return; // a timer is running: they're logging
	const last = tasks[0] ? new Date(tasks[0].end || tasks[0].start).getTime() : 0;
	if (!force && now.getTime() - last < r.intervalMin * 60000) return; // logged recently
	notify('qtl-nudge', 'What are you working on?', 'Nothing logged for a while. Click to log it now.', [{ title: 'Log now' }, { title: 'Snooze 30 min' }]);
}

function notify(id, title, message, buttons) {
	chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 0, ...(buttons ? { buttons } : {}) });
}

async function openPopupWindow() {
	try {
		await chrome.action.openPopup(); // Chrome 127+ when a browser window is focused
	} catch {
		await chrome.windows.create({ url: POPUP_WINDOW, type: 'popup', width: 420, height: 640, focused: true });
	}
}

chrome.notifications.onClicked.addListener((id) => {
	chrome.notifications.clear(id);
	if (id === 'qtl-nudge') openPopupWindow();
	else if (id.startsWith('qtl-logged')) chrome.tabs.create({ url: DASHBOARD });
});
chrome.notifications.onButtonClicked.addListener((id, idx) => {
	chrome.notifications.clear(id);
	if (id !== 'qtl-nudge') return;
	if (idx === 0) openPopupWindow();
	else chrome.alarms.create('snooze-end', { delayInMinutes: 30 });
});

// ------------------------------------------------------------------ commands
chrome.commands.onCommand.addListener(async (cmd) => {
	if (cmd === 'stop-timer') {
		const t = await stopTimer();
		notify('qtl-logged-stop', t ? 'Timer stopped' : 'No timer running', t ? `${t.text || 'Task'} - ${fmtDuration(taskMinutes(t))}` : 'Start one from the popup with Ctrl+Enter.');
	} else if (cmd === 'open-dashboard') {
		chrome.tabs.create({ url: DASHBOARD });
	}
});

// ------------------------------------------------------------------ omnibox: "tl fixed vpn #network 30m"
chrome.omnibox.setDefaultSuggestion({ description: 'Log a task: text #category @client !ticket 30m +tag $' });

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
	const s = await loadSettings();
	const p = parseQuick(text, s.categories);
	const meta = describeParse(p);
	chrome.omnibox.setDefaultSuggestion({
		description: `Log: <match>${escapeXml(p.text || '…')}</match>${meta ? `  <dim>${escapeXml(meta)}</dim>` : ''}`,
	});
	suggest([]);
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
	const s = await loadSettings();
	const p = parseQuick(text, s.categories);
	if (!p.text) return;
	const t = await addTask({ ...p, category: p.category || s.defaultCategory, billable: p.billable || s.defaultBillable });
	notify(`qtl-logged-${t.id}`, 'Logged', `${t.text}${t.durationMin ? ` - ${fmtDuration(t.durationMin)}` : ''}`);
});

// ------------------------------------------------------------------ context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	const s = await loadSettings();
	const url = info.menuItemId === 'log-link' ? info.linkUrl : info.pageUrl || tab?.url || '';
	const base = {
		category: s.defaultCategory,
		billable: s.defaultBillable,
		link: url,
		linkTitle: info.menuItemId === 'log-link' ? '' : tab?.title || '',
		ticket: s.autoTicket ? detectTicket(url, s.ticketPatterns) : '',
	};
	let fields;
	if (info.menuItemId === 'log-selection') {
		const p = parseQuick(String(info.selectionText || '').slice(0, 500), s.categories);
		fields = { ...base, ...p, link: p.link || base.link, ticket: p.ticket || base.ticket, category: p.category || base.category };
	} else {
		fields = { ...base, text: info.menuItemId === 'log-link' ? info.linkUrl : tab?.title || url };
	}
	const t = await addTask(fields);
	notify(`qtl-logged-${t.id}`, 'Logged', `${t.text}${t.ticket ? ` (ticket ${t.ticket})` : ''}`);
});
