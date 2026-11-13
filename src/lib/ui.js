// ui.js - shared task row rendering (popup + dashboard).
import { h } from './dom.js';
import { isRunning, taskMinutes } from './model.js';
import { fmtDuration, fmtTime } from './time.js';

/** Chips for a task's metadata. */
export function metaChips(t) {
	return [
		t.category && h('span', { class: 'chip cat' }, t.category),
		t.client && h('span', { class: 'chip', title: 'Client / dept' }, `@${t.client}`),
		t.ticket && h('span', { class: 'chip tick', title: 'Ticket' }, `#${t.ticket}`),
		...t.tags.map((g) => h('span', { class: 'chip' }, `+${g}`)),
		t.billable && h('span', { class: 'chip bill', title: 'Billable' }, '$'),
		t.link && h('a', { class: 'chip', href: t.link, target: '_blank', rel: 'noopener noreferrer', title: t.link }, '↗ ' + (t.linkTitle || hostOf(t.link))),
		t.notes && h('span', { class: 'chip', title: t.notes }, '✎ notes'),
	];
}

const hostOf = (u) => {
	try {
		return new URL(u).hostname.replace(/^www\./, '');
	} catch {
		return 'link';
	}
};

/**
 * One task row. actions: { resume, edit, del } callbacks (each optional).
 */
export function taskRow(t, actions = {}, now = new Date()) {
	const run = isRunning(t);
	const min = taskMinutes(t, now);
	const btn = (label, title, fn) =>
		fn && h('button', { class: 'icon-btn', type: 'button', title, 'aria-label': title, onclick: (e) => (e.stopPropagation(), fn(t)) }, label);
	return h(
		'div',
		{ class: `task${run ? ' running' : ''}`, dataset: { id: t.id } },
		h('div', { class: 't-text' }, t.text || h('span', { class: 'muted' }, '(no description)')),
		h(
			'div',
			{ class: 't-side' },
			h('span', { class: 't-actions' }, btn('▶', 'Start again (timer)', actions.resume), btn('✎', 'Edit', actions.edit), btn('🗑', 'Delete', actions.del)),
			h('span', { title: new Date(t.start).toLocaleString() }, run ? 'running' : min ? fmtDuration(min) : fmtTime(t.start)),
		),
		h('div', { class: 't-meta' }, metaChips(t), h('span', { class: 'chip', title: 'Started' }, fmtTime(t.start))),
	);
}
