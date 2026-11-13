// time.js - date/duration helpers. Pure functions (no chrome.* APIs) so they're unit-testable in Node.
// All "day" logic uses the user's LOCAL calendar, never UTC, so a 9 PM task lands on the right day.

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day key, e.g. "2026-11-12". */
export function dayKey(d) {
	const x = new Date(d);
	return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function startOfDay(d) {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

export function addDays(d, n) {
	const x = new Date(d);
	x.setDate(x.getDate() + n);
	return x;
}

/** Monday 00:00 of the week containing d (ISO weeks start Monday). */
export function startOfWeek(d) {
	const x = startOfDay(d);
	const dow = (x.getDay() + 6) % 7; // Mon=0 .. Sun=6
	return addDays(x, -dow);
}

export function startOfMonth(d) {
	const x = startOfDay(d);
	x.setDate(1);
	return x;
}

/** Minutes -> "45m", "1h", "2h 05m". Rounds to whole minutes. */
export function fmtDuration(min) {
	const m = Math.max(0, Math.round(Number(min) || 0));
	const h = Math.floor(m / 60);
	const r = m % 60;
	if (!h) return `${r}m`;
	return r ? `${h}h ${pad(r)}m` : `${h}h`;
}

/** Minutes -> decimal hours string "1.25" (timesheet friendly). */
export function fmtHours(min, digits = 2) {
	return (Math.max(0, Number(min) || 0) / 60).toFixed(digits);
}

/** Milliseconds -> "1:05:09" / "5:09" stopwatch format. */
export function fmtClock(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = s % 60;
	return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Local "HH:MM" for a timestamp. */
export function fmtTime(d) {
	const x = new Date(d);
	return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d) {
	const x = new Date(d);
	return `${dayKey(x)}T${fmtTime(x)}`;
}

/** Round minutes UP to the next increment (0 = no rounding). Billing-style. */
export function roundUp(min, inc) {
	if (!inc || inc <= 0) return min;
	return Math.ceil(min / inc) * inc;
}

/**
 * Named date ranges for reports. Returns { from, to, label } where `to` is EXCLUSIVE.
 * Presets: today, yesterday, week, lastweek, month, lastmonth, last7, last30.
 */
export function rangePreset(name, now = new Date()) {
	const today = startOfDay(now);
	switch (name) {
		case 'today':
			return { from: today, to: addDays(today, 1), label: 'Today' };
		case 'yesterday':
			return { from: addDays(today, -1), to: today, label: 'Yesterday' };
		case 'week': {
			const f = startOfWeek(now);
			return { from: f, to: addDays(f, 7), label: 'This week' };
		}
		case 'lastweek': {
			const t = startOfWeek(now);
			return { from: addDays(t, -7), to: t, label: 'Last week' };
		}
		case 'month': {
			const f = startOfMonth(now);
			const t = new Date(f);
			t.setMonth(t.getMonth() + 1);
			return { from: f, to: t, label: 'This month' };
		}
		case 'lastmonth': {
			const t = startOfMonth(now);
			const f = new Date(t);
			f.setMonth(f.getMonth() - 1);
			return { from: f, to: t, label: 'Last month' };
		}
		case 'last30':
			return { from: addDays(today, -29), to: addDays(today, 1), label: 'Last 30 days' };
		case 'last7':
		default:
			return { from: addDays(today, -6), to: addDays(today, 1), label: 'Last 7 days' };
	}
}

/** Previous working day (Mon -> Fri), used by the standup generator. */
export function previousWorkday(now = new Date(), workdays = [1, 2, 3, 4, 5]) {
	let d = addDays(startOfDay(now), -1);
	for (let i = 0; i < 7; i++) {
		if (workdays.includes(d.getDay())) return d;
		d = addDays(d, -1);
	}
	return addDays(startOfDay(now), -1);
}
