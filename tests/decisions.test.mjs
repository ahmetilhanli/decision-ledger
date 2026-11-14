// Unit tests for the pure decision logic (no Forge, no network). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecision, itemsOf, activeOf, toProperty, supersede, keywords, matches, jqlWord, stem, reviewDue, textClause, MAX_PROPERTY_CHARS } from '../src/decisions.js';

const NOW = new Date('2026-11-15T10:00:00Z');
const good = { statement: 'Annual plans are billed up front, no monthly option.', rationale: 'Finance needs predictable cash; churn data showed monthly users leave in month two.' };

test('a decision needs a statement and a rationale', () => {
  assert.equal(buildDecision(good, 'acc-1', NOW, 'd-1').item.status, 'active');
  assert.match(buildDecision({ ...good, statement: 'Yes' }).error, /statement/);
  assert.match(buildDecision({ ...good, rationale: '' }).error, /rationale/);
  assert.match(buildDecision({ ...good, url: 'notes.txt' }).error, /not a valid/);
  assert.match(buildDecision({ ...good, statement: 'x'.repeat(501) }).error, /under 500/);
});

test('toProperty indexes only active decisions', () => {
  const a = buildDecision(good, 'acc-1', NOW, 'd-1').item;
  const b = buildDecision({ statement: 'We use Postgres for the ledger.', rationale: 'Team knows it and it supports row locks.' }, 'acc-1', NOW, 'd-2').item;
  const { items } = supersede([a, b], 'd-2');
  const p = toProperty(items).value;
  assert.equal(p.activeCount, 1);
  assert.ok(p.text.includes('Annual plans') && !p.text.includes('Postgres'));
  assert.equal(activeOf(p).length, 1);
});

test('supersede records the replacement and refuses repeats', () => {
  const a = buildDecision(good, 'acc-1', NOW, 'd-1').item;
  const { items } = supersede([a], 'd-1', 'd-9');
  assert.deepEqual([items[0].status, items[0].supersededBy], ['superseded', 'd-9']);
  assert.match(supersede(items, 'd-1').error, /already superseded/);
  assert.match(supersede(items, 'd-404').error, /No decision/);
});

test('itemsOf tolerates missing and malformed data', () => {
  assert.deepEqual(itemsOf(null), []);
  assert.deepEqual(itemsOf({ items: 'x' }), []);
  assert.equal(itemsOf({ items: [null, { id: 'd-1', statement: 'ok ok ok ok' }, { statement: 1 }] }).length, 1);
});

test('keywords drop short and filler words; matches explains a hit', () => {
  assert.deepEqual(keywords('Update the pricing page with annual billing for new customers'), ['pricing', 'page', 'annual', 'billing', 'customers']);
  const a = buildDecision(good, 'acc-1', NOW, 'd-1').item;
  assert.deepEqual(matches(a, ['annual', 'pricing', 'churn']), ['annual', 'churn']);
  assert.equal(jqlWord('a"b\\c) OR x'), 'abcORx');
  assert.equal(textClause(['refunds', 'page']), '(decisionText ~ "refunds" OR decisionText ~ "refund" OR decisionText ~ "page")');
  assert.ok(!textClause(['pricing', 'billing']).includes('*'), 'no wildcards: they broke OR queries on a live site');
});

test('matching ignores plural and verb endings', () => {
  const d = buildDecision({ statement: 'Annual plans get a full refund within 30 days of purchase.', rationale: 'Support wanted one rule; customers were billed twice in the pilot.' }, 'acc-1', NOW, 'd-1').item;
  assert.deepEqual(matches(d, ['refunds', 'billing', 'plan', 'pricing']), ['refunds', 'billing', 'plan']);
  assert.deepEqual(['refunds', 'policies', 'billing', 'billed', 'bus', 'pass'].map(stem), ['refund', 'policy', 'bill', 'bill', 'bus', 'pass']);
});

test('review dates: validated, must be in the future, and flagged when passed', () => {
  assert.match(buildDecision({ ...good, reviewBy: '2026-13-40' }, 'a', NOW).error, /not a valid review date/);
  assert.match(buildDecision({ ...good, reviewBy: '2026-11-15' }, 'a', NOW).error, /not in the future/);
  const d = buildDecision({ ...good, reviewBy: '2026-12-01' }, 'a', NOW, 'd-1').item;
  assert.equal(reviewDue(d, NOW), false);
  assert.equal(reviewDue(d, new Date('2026-12-01T08:00:00Z')), true);
  assert.equal(reviewDue({ ...d, status: 'superseded' }, new Date('2027-01-01T00:00:00Z')), false);
});

test('toProperty refuses to exceed the Jira property size limit', () => {
  const items = [];
  for (let i = 0; i < 40; i++) items.push(buildDecision({ statement: `Decision number ${i} about a long topic`, rationale: 'because '.repeat(120) }, 'a', NOW, `d-${i}`).item);
  assert.match(toProperty(items).error, /too many decisions/);
  assert.ok(JSON.stringify(toProperty(items.slice(0, 5)).value).length < MAX_PROPERTY_CHARS);
});

test('rationale length is capped', () => {
  assert.match(buildDecision({ ...good, rationale: 'x'.repeat(2001) }).error, /under 2000/);
});
