// parse.js - the quick-entry syntax. Type one line, get a structured task.
//
//   Fixed VPN for remote user #network @Acme !INC-4521 45m +vpn $
//
//   #category   matches an existing category (case/punctuation-insensitive: #breakfix -> "Break/Fix");
//               unknown names become new categories.     #"Long Name" works too.
//   @client     client / company / department.           @"Acme Corp"
//   !ticket     ticket or work-order id.                 !1234  !INC-4521
//   +tag        free-form tags (repeatable).
//   45m 1h 1h30 1.5h 1:15   duration of work ALREADY DONE (ends now). No duration = instant entry.
//   $           billable.
//   https://... first URL becomes the task link.
// Everything else is the description.

/** Normalize for fuzzy category matching: lowercase alphanumerics only. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Parse a duration token into minutes, or null if it isn't one.
 * Accepts: 45m, 45min, 2h, 1.5h, 1h30, 1h30m, 1:15
 */
export function parseDuration(tok) {
	const t = String(tok || '').trim().toLowerCase();
	let m;
	if ((m = t.match(/^(\d{1,4})\s*(m|min|mins|minutes?)$/))) return +m[1];
	if ((m = t.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*(h|hr|hrs|hours?)$/))) return Math.round(parseFloat(m[1]) * 60);
	if ((m = t.match(/^(\d{1,3})h(\d{1,2})m?$/))) return +m[1] * 60 + +m[2];
	if ((m = t.match(/^(\d{1,2}):([0-5]\d)$/))) return +m[1] * 60 + +m[2];
	return null;
}

/** Resolve a #category token against known categories. Returns the canonical name. */
export function matchCategory(raw, categories = []) {
	const n = norm(raw);
	if (!n) return '';
	const exact = categories.find((c) => norm(c) === n);
	if (exact) return exact;
	const prefix = categories.filter((c) => norm(c).startsWith(n));
	if (prefix.length === 1) return prefix[0];
	return raw.trim();
}

const URL_RE = /^https?:\/\/[^\s]+$/i;
// Tokens: sigil + "quoted value"  |  "quoted text"  |  bare word
const TOKEN_RE = /([#@!+])"([^"]*)"|"([^"]*)"|(\S+)/g;

/**
 * Parse a quick-entry line.
 * @returns {{text:string, category:string, client:string, ticket:string, tags:string[],
 *            durationMin:number|null, billable:boolean, link:string}}
 */
export function parseQuick(input, categories = []) {
	const out = { text: '', category: '', client: '', ticket: '', tags: [], durationMin: null, billable: false, link: '' };
	const words = [];
	for (const m of String(input || '').matchAll(TOKEN_RE)) {
		if (m[1]) {
			apply(m[1], m[2]);
			continue;
		}
		if (m[3] !== undefined) {
			words.push(m[3]);
			continue;
		}
		const tok = m[4];
		const sig = tok[0];
		if (tok.length > 1 && '#@!+'.includes(sig)) {
			apply(sig, tok.slice(1));
			continue;
		}
		if (tok === '$') {
			out.billable = true;
			continue;
		}
		if (out.durationMin === null) {
			const d = parseDuration(tok);
			if (d !== null && d > 0) {
				out.durationMin = d;
				continue;
			}
		}
		if (!out.link && URL_RE.test(tok)) {
			out.link = tok.replace(/[),.;]+$/, '');
			continue;
		}
		words.push(tok);
	}
	out.text = words.join(' ').trim();
	return out;

	function apply(sig, val) {
		const v = String(val || '').trim();
		if (!v) return;
		if (sig === '#') out.category = matchCategory(v, categories);
		else if (sig === '@') out.client = v;
		else if (sig === '!') out.ticket = v;
		else if (sig === '+' && !out.tags.includes(v.toLowerCase())) out.tags.push(v.toLowerCase());
	}
}

/** Human-readable one-line preview of a parse (used by the popup hint and the omnibox). */
export function describeParse(p) {
	const bits = [];
	if (p.category) bits.push(`#${p.category}`);
	if (p.client) bits.push(`@${p.client}`);
	if (p.ticket) bits.push(`!${p.ticket}`);
	if (p.durationMin) bits.push(`${p.durationMin}m`);
	for (const t of p.tags) bits.push(`+${t}`);
	if (p.billable) bits.push('$');
	if (p.link) bits.push('link');
	return bits.join('  ');
}
