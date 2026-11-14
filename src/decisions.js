// Pure decision logic: no Forge imports, so it can be unit-tested with plain Node.

// The issue property that stores decisions.
// Shape: { items: [ {id, statement, rationale, url, reviewBy, status, supersededBy, decidedBy, decidedAt} ], text, activeCount }
// `text` and `activeCount` are derived fields that Jira indexes for JQL (see jira:entityProperty in the manifest).
export const PROPERTY_KEY = 'decision-ledger';

// Jira rejects issue properties above 32,768 characters; stay under it with room to spare.
export const MAX_PROPERTY_CHARS = 30000;

const STOP = new Set(('about after again also been before being could does doing done each from have having here into just more most must need only ' +
  'other over same should some such than that their them then there these they this those through under until very were what when where which while ' +
  'will with would your update create make add fix new use using issue task work anything something decided decision decisions').split(' '));

// Validates and normalises one decision. Returns { item } or { error }.
export function buildDecision({ statement, rationale, url, reviewBy }, decidedBy, now = new Date(), id = newId(now)) {
  const s = String(statement || '').trim().replace(/\s+/g, ' ');
  const r = String(rationale || '').trim().replace(/\s+/g, ' ');
  const link = String(url || '').trim();
  const review = String(reviewBy || '').trim();
  if (s.length < 10) return { error: 'A decision needs a statement of at least 10 characters that says what was decided.' };
  if (s.length > 500) return { error: 'Keep the decision statement under 500 characters; put the detail in the rationale.' };
  // A decision without a reason cannot be re-examined later, which is the point of the ledger.
  if (r.length < 10) return { error: 'A decision needs a rationale of at least 10 characters that says why.' };
  if (r.length > 2000) return { error: 'Keep the rationale under 2000 characters and link to the full notes.' };
  if (link && !/^https?:\/\/\S+$/i.test(link)) return { error: `"${link}" is not a valid http(s) link.` };
  if (review && !validDate(review)) return { error: `"${review}" is not a valid review date. Use YYYY-MM-DD.` };
  if (review && review <= now.toISOString().slice(0, 10)) return { error: `The review date ${review} is not in the future.` };
  return { item: { id, statement: s, rationale: r, url: link || null, reviewBy: review || null, status: 'active', supersededBy: null, decidedBy: decidedBy || null, decidedAt: now.toISOString() } };
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function newId(now = new Date()) {
  return 'd-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 5);
}

// Reads the items out of a stored property value, tolerating missing or malformed data.
export function itemsOf(propertyValue) {
  const items = propertyValue && Array.isArray(propertyValue.items) ? propertyValue.items : [];
  return items.filter((i) => i && typeof i.statement === 'string' && typeof i.id === 'string');
}

export const activeOf = (propertyValue) => itemsOf(propertyValue).filter((i) => i.status === 'active');

// True when an active decision has passed its review date.
export const reviewDue = (item, now = new Date()) => item.status === 'active' && !!item.reviewBy && item.reviewBy <= now.toISOString().slice(0, 10);

// Builds the value to store: the items plus the derived fields Jira indexes. Returns { value } or { error }.
export function toProperty(items) {
  const active = items.filter((i) => i.status === 'active');
  const value = { items, text: active.map((i) => `${i.statement} ${i.rationale}`).join(' \n ').slice(0, 8000), activeCount: active.length };
  if (JSON.stringify(value).length > MAX_PROPERTY_CHARS) {
    return { error: 'This issue holds too many decisions to store another one. Record the decision on a new issue and link the two.' };
  }
  return { value };
}

// Marks one active decision as superseded. `byId` is the id of the decision that replaces it, or null if it was withdrawn.
// Returns { items } or { error }.
export function supersede(items, id, byId = null) {
  const target = items.find((i) => i.id === id);
  if (!target) return { error: `No decision with id "${id}" on this issue. Use get-decisions to see the ids.` };
  if (target.status !== 'active') return { error: `Decision ${id} is already superseded.` };
  return { items: items.map((i) => (i.id === id ? { ...i, status: 'superseded', supersededBy: byId } : i)) };
}

// Picks the words worth searching for in a free-text query or an issue summary.
export function keywords(text, max = 5) {
  const seen = new Set();
  for (const w of String(text || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
    if (!STOP.has(w)) seen.add(w);
    if (seen.size >= max) break;
  }
  return [...seen];
}

// Crude stem so "refunds" finds "refund" and "billing" finds "billed". Good enough for matching, not linguistics.
export function stem(word) {
  const w = String(word || '').toLowerCase();
  for (const [end, put] of [['ies', 'y'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']]) {
    if (w.endsWith(end) && w.length - end.length + put.length >= 4) return w.slice(0, -end.length) + put;
  }
  return w;
}

// Which of the words occur in a decision (compared by stem). Used to rank and to explain why a decision was returned.
export function matches(item, words) {
  const hay = new Set((`${item.statement} ${item.rationale}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(stem));
  return words.filter((w) => hay.has(stem(w)));
}

// Strips everything that is not a letter or digit so a word is safe inside a JQL string literal.
export const jqlWord = (w) => String(w).replace(/[^\p{L}\p{N}]/gu, '');

// The JQL clause that finds issues whose active decisions mention any of the words.
// Plain words only: Jira stems them itself. Wildcards ("refund*") are avoided on purpose, because on a live site an
// OR of wildcard clauses returned nothing whenever the first clause had no match.
export function textClause(words) {
  const terms = [...new Set(words.flatMap((w) => [jqlWord(w), jqlWord(stem(w))]).filter(Boolean))];
  return `(${terms.map((t) => `decisionText ~ "${t}"`).join(' OR ')})`;
}
