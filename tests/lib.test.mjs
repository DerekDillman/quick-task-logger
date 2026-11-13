// Unit tests for the pure modules. Run: npm test  (Node 20+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseQuick, matchCategory } from '../src/lib/parse.js';
import { normalizeTask, migrateLegacy, newTask, taskMinutes, safeLink, detectTicket, dedupe, DEFAULT_CATEGORIES } from '../src/lib/model.js';
import { toCSV, parseCSV, csvRowsToRaw, csvCell, buildReport, reportMarkdown, standup, filterTasks, fromBackup, toBackup } from '../src/lib/report.js';
import { fmtDuration, fmtClock, rangePreset, previousWorkday, roundUp, dayKey } from '../src/lib/time.js';

test('parseDuration', () => {
	assert.equal(parseDuration('45m'), 45);
	assert.equal(parseDuration('90min'), 90);
	assert.equal(parseDuration('2h'), 120);
	assert.equal(parseDuration('1.5h'), 90);
	assert.equal(parseDuration('1h30'), 90);
	assert.equal(parseDuration('1h30m'), 90);
	assert.equal(parseDuration('1:15'), 75);
	assert.equal(parseDuration('vpn'), null);
	assert.equal(parseDuration('2026'), null);
});

test('parseQuick: full syntax', () => {
	const p = parseQuick('Fixed VPN for remote user #network @Acme !INC-4521 45m +vpn +VPN $ https://x.example/t/1', DEFAULT_CATEGORIES);
	assert.equal(p.text, 'Fixed VPN for remote user');
	assert.equal(p.category, 'Network');
	assert.equal(p.client, 'Acme');
	assert.equal(p.ticket, 'INC-4521');
	assert.equal(p.durationMin, 45);
	assert.deepEqual(p.tags, ['vpn']);
	assert.equal(p.billable, true);
	assert.equal(p.link, 'https://x.example/t/1');
});

test('parseQuick: quoted values, fuzzy category, only first duration', () => {
	const p = parseQuick('Swap drive @"Big Corp" #breakfix 30m then 2h "literal #hash"', DEFAULT_CATEGORIES);
	assert.equal(p.client, 'Big Corp');
	assert.equal(p.category, 'Break/Fix');
	assert.equal(p.durationMin, 30);
	assert.equal(p.text, 'Swap drive then 2h literal #hash');
	assert.equal(matchCategory('admin', DEFAULT_CATEGORIES), 'Administration');
	assert.equal(matchCategory('Brand New', DEFAULT_CATEGORIES), 'Brand New');
});

test('normalize + migrate v2 tasks', () => {
	const v2 = [
		{ text: 'Password reset', category: 'Break/Fix', timestamp: '2025-05-20T14:00:00Z', company: 'Acme', ticket: '12', notes: '', link: 'javascript:alert(1)' },
		{ text: 'Password reset', category: 'Break/Fix', timestamp: '2025-05-20T14:00:00Z', company: 'Acme' }, // dup
		{ text: 'Later', timestamp: '2025-05-21T09:00:00Z' },
	];
	const m = migrateLegacy(v2);
	assert.equal(m.length, 2);
	assert.equal(m[0].text, 'Later'); // newest first
	assert.equal(m[1].client, 'Acme');
	assert.equal(m[1].link, ''); // unsafe scheme dropped
	assert.equal(m[1].start, '2025-05-20T14:00:00.000Z');
	assert.equal(taskMinutes(m[1]), 0); // legacy entries are instant notes
	assert.ok(m[0].id);
});

test('newTask duration and running timer', () => {
	const now = new Date('2026-11-12T15:00:00Z');
	const t = newTask({ text: 'x', durationMin: 30 }, now);
	assert.equal(t.start, '2026-11-12T14:30:00.000Z');
	assert.equal(t.end, '2026-11-12T15:00:00.000Z');
	assert.equal(taskMinutes(t, now), 30);
	const r = newTask({ text: 'y', running: true }, now);
	assert.equal(r.end, null);
	assert.equal(taskMinutes(r, new Date('2026-11-12T15:20:00Z')), 20);
});

test('safeLink', () => {
	assert.equal(safeLink('https://a.example/x'), 'https://a.example/x');
	assert.equal(safeLink('JAVASCRIPT:alert(1)'), '');
	assert.equal(safeLink('data:text/html,hi'), '');
	assert.equal(safeLink('not a url'), '');
});

test('detectTicket', () => {
	assert.equal(detectTicket('https://acme.freshservice.com/a/tickets/4521'), '4521');
	assert.equal(detectTicket('https://sdp.local/WorkOrder.do?woMode=viewWO&woID=88123'), '88123');
	assert.equal(detectTicket('https://acme.atlassian.net/browse/OPS-77'), 'OPS-77');
	assert.equal(detectTicket('https://github.com/o/r/issues/12'), '12');
	assert.equal(detectTicket('https://example.com/'), '');
	assert.equal(detectTicket('https://x/y?id=5', [{ name: 'bad', pattern: '([' }, { name: 'ok', pattern: '[?&]id=(\\d+)' }]), '5');
});

test('CSV round trip, formula injection neutralized', () => {
	const now = new Date('2026-11-12T18:00:00Z');
	const tasks = [
		newTask({ text: 'Quote "this", ok\nline2', category: 'Network', client: '=cmd|calc', ticket: '9', durationMin: 15, tags: ['a', 'b'], billable: true }, now),
	];
	const csv = toCSV(tasks, { now });
	assert.match(csv, /"Quote ""this"", ok\nline2"/);
	assert.match(csv, /'=cmd\|calc/);
	assert.equal(csvCell('-1'), "'-1");
	const rows = parseCSV(csv);
	assert.equal(rows.length, 1);
	const raw = csvRowsToRaw(rows)[0];
	assert.equal(raw.text, 'Quote "this", ok\nline2');
	assert.equal(raw.client, '=cmd|calc');
	assert.equal(raw.durationMin, 15);
	assert.equal(raw.billable, true);
	assert.deepEqual(raw.tags, ['a', 'b']);
	assert.equal(raw.id, tasks[0].id);
});

test('CSV import of the v2 export format', () => {
	const v2csv = 'Date,Time,Category,Task,Company,Ticket,Notes,Link\n"5/20/2025","9:00:00 AM","Network","Firewall rule","Acme","T1","",""\n';
	const raw = csvRowsToRaw(parseCSV(v2csv))[0];
	assert.equal(raw.text, 'Firewall rule');
	assert.equal(raw.client, 'Acme');
	assert.equal(normalizeTask(raw).category, 'Network');
});

test('report + markdown + filters', () => {
	const now = new Date('2026-11-12T18:00:00');
	const a = newTask({ text: 'A', category: 'Network', client: 'Acme', durationMin: 50, billable: true }, now);
	const b = newTask({ text: 'B', category: 'Network', durationMin: 20 }, now);
	const c = newTask({ text: 'C', category: 'Meeting', client: 'Acme', ticket: 'X1', durationMin: 30 }, now);
	const r = buildReport([a, b, c], { now });
	assert.equal(r.totalMin, 100);
	assert.equal(r.billableMin, 50);
	assert.equal(r.byCategory[0].name, 'Network');
	assert.equal(r.byCategory[0].min, 70);
	assert.deepEqual(r.tickets, ['X1']);
	assert.equal(buildReport([a, b, c], { now, roundTo: 15 }).totalMin, 60 + 30 + 30);
	const md = reportMarkdown([a, b, c], { label: 'Today', now });
	assert.match(md, /Work summary: Today/);
	assert.match(md, /Network: 1h 10m/);
	assert.equal(filterTasks([a, b, c], { q: 'acme' }).length, 2);
	assert.equal(filterTasks([a, b, c], { billable: 'yes' }).length, 1);
});

test('standup uses the previous workday', () => {
	const mon = new Date('2026-11-16T09:00:00'); // Monday
	const fri = newTask({ text: 'Friday thing', durationMin: 10 }, new Date('2026-11-13T15:00:00'));
	const today = newTask({ text: 'Monday thing', durationMin: 5 }, new Date('2026-11-16T08:30:00'));
	const s = standup([today, fri], { now: mon });
	assert.match(s, /Friday/);
	assert.match(s, /Friday thing/);
	assert.match(s, /Monday thing/);
	assert.equal(dayKey(previousWorkday(mon)), '2026-11-13');
});

test('backup round trip + dedupe', () => {
	const t = newTask({ text: 'x' });
	const back = fromBackup(toBackup([t], { theme: 'dark' }));
	assert.equal(back.tasks[0].id, t.id);
	assert.equal(dedupe([t, { ...t }]).length, 1);
	assert.throws(() => fromBackup('{"nope":1}'));
});

test('time helpers', () => {
	assert.equal(fmtDuration(45), '45m');
	assert.equal(fmtDuration(125), '2h 05m');
	assert.equal(fmtDuration(120), '2h');
	assert.equal(fmtClock(3909000), '1:05:09');
	assert.equal(roundUp(7, 15), 15);
	assert.equal(roundUp(7, 0), 7);
	const w = rangePreset('week', new Date('2026-11-12T12:00:00')); // Thursday
	assert.equal(dayKey(w.from), '2026-11-09');
	assert.equal(dayKey(w.to), '2026-11-16');
});
