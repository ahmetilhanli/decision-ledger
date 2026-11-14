// Handler tests against an in-memory Jira (no Forge, no network). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDecisions, recordDecision, withdrawDecision, findDecisions } from '../src/handlers.js';
import { PROPERTY_KEY, stem } from '../src/decisions.js';

const NOW = new Date('2026-11-15T10:00:00Z');

// A small fake of the Jira calls the handlers use. `hidden` issues exist but the caller cannot see them.
function fakeJira({ indexBroken = false, readOnly = [] } = {}) {
  const issues = new Map();
  const add = (key, summary, hidden = false) => issues.set(key, { key, summary, status: 'To Do', hidden, prop: null });
  const jira = {
    add, issues, searches: [],
    async getIssue(k) { const i = issues.get(k); return i && !i.hidden ? { key: i.key, summary: i.summary, status: i.status } : null; },
    async getProperty(k) { return issues.get(k)?.prop ?? null; },
    async putProperty(k, value) { if (readOnly.includes(k)) return false; issues.get(k).prop = JSON.parse(JSON.stringify(value)); return true; },
    async search(jql, max) {
      jira.searches.push(jql);
      const indexed = jql.includes('activeDecisions');
      if (indexed && indexBroken) return { error: 400 };
      const project = (jql.match(/project = "([A-Z0-9_]+)"/) || [])[1];
      assert.ok(!jql.includes('*'), 'wildcards are not allowed in the text clause');
      const words = [...jql.matchAll(/decisionText ~ "([^"]+)"/g)].map((m) => stem(m[1]));
      const out = [];
      for (const i of issues.values()) {
        if (i.hidden) continue;
        if (project && !i.key.startsWith(project + '-')) continue;
        if (indexed) {
          if (!i.prop || !(i.prop.activeCount > 0)) continue;
          const tokens = (i.prop.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
          if (words.length && !words.some((w) => tokens.some((t) => stem(t) === w))) continue;
        }
        out.push({ key: i.key, fields: { summary: i.summary }, properties: i.prop ? { [PROPERTY_KEY]: i.prop } : {} });
      }
      return { issues: out.slice(0, max) };
    },
  };
  return jira;
}

const refund = { statement: 'Annual plans get a full refund within 30 days of purchase and no refund after that.', rationale: 'Support wanted one rule to quote; finance accepted 30 days.' };

test('record, read back, and reject bad input', async () => {
  const jira = fakeJira(); jira.add('OPS-1', 'Decide refund policy');
  const r = await recordDecision(jira, { issueKey: ' ops-1 ', ...refund }, 'acc-1', NOW);
  assert.equal(r.activeCount, 1); assert.equal(r.saved.decidedBy, 'acc-1');
  assert.equal(jira.issues.get('OPS-1').prop.activeCount, 1);
  const g = await getDecisions(jira, { issueKey: 'OPS-1' }, NOW);
  assert.equal(g.decisions[0].statement, refund.statement);
  assert.match((await recordDecision(jira, { issueKey: 'OPS-1', statement: 'Yes', rationale: 'because we said so' }, 'a', NOW)).error, /statement/);
  assert.match((await recordDecision(jira, { issueKey: 'not a key', ...refund }, 'a', NOW)).error, /not a Jira issue key/);
  assert.match((await recordDecision(jira, { issueKey: 'OPS-404', ...refund }, 'a', NOW)).error, /not found or you cannot see/);
  assert.match((await recordDecision(jira, { issueKey: 'OPS-1', ...refund }, 'a', NOW)).error, /already in force/);
  assert.equal(jira.issues.get('OPS-1').prop.items.length, 1, 'failed calls must not write');
});

test('a hidden issue is reported as not found, and its decisions never leak into search', async () => {
  const jira = fakeJira(); jira.add('SEC-1', 'Secret pricing', true); jira.add('OPS-1', 'Public');
  jira.issues.get('SEC-1').prop = { items: [{ id: 'd-1', statement: 'Secret refund rule for partners', rationale: 'confidential reason here', status: 'active' }], text: 'Secret refund rule for partners', activeCount: 1 };
  assert.match((await getDecisions(jira, { issueKey: 'SEC-1' })).error, /not found or you cannot see/);
  assert.equal((await findDecisions(jira, { query: 'refund' }, NOW)).decisionCount, 0);
});

test('superseding keeps history and points to the replacement', async () => {
  const jira = fakeJira(); jira.add('OPS-1', 'Decide refund policy');
  const first = await recordDecision(jira, { issueKey: 'OPS-1', ...refund }, 'a', NOW);
  const second = await recordDecision(jira, { issueKey: 'OPS-1', statement: 'Annual plans get a full refund within 14 days only.', rationale: 'Chargeback data after the first quarter.', supersedesId: first.saved.id }, 'a', NOW);
  assert.equal(second.activeCount, 1); assert.equal(second.superseded, first.saved.id);
  const items = jira.issues.get('OPS-1').prop.items;
  assert.deepEqual(items.map((i) => i.status), ['superseded', 'active']);
  assert.equal(items[0].supersededBy, second.saved.id);
  assert.ok(!jira.issues.get('OPS-1').prop.text.includes('30 days'), 'superseded text must leave the index');
  assert.match((await recordDecision(jira, { issueKey: 'OPS-1', statement: 'Another replacement of the old rule.', rationale: 'Trying to replace twice.', supersedesId: first.saved.id }, 'a', NOW)).error, /already superseded/);
  assert.match((await recordDecision(jira, { issueKey: 'OPS-1', statement: 'Replacement of a missing decision.', rationale: 'There is no such decision id.', supersedesId: 'd-nope' }, 'a', NOW)).error, /No decision with id/);
  assert.equal(jira.issues.get('OPS-1').prop.items.length, 2, 'a failed supersede must not add the new decision');
});

test('withdraw retires a decision; unknown ids and read-only issues are reported', async () => {
  const jira = fakeJira({ readOnly: ['OPS-2'] }); jira.add('OPS-1', 'A'); jira.add('OPS-2', 'B');
  const r = await recordDecision(jira, { issueKey: 'OPS-1', ...refund }, 'a', NOW);
  assert.equal((await withdrawDecision(jira, { issueKey: 'OPS-1', decisionId: r.saved.id })).activeCount, 0);
  assert.match((await withdrawDecision(jira, { issueKey: 'OPS-1', decisionId: r.saved.id })).error, /already superseded/);
  assert.match((await withdrawDecision(jira, { issueKey: 'OPS-1', decisionId: '' })).error, /No decision with id/);
  assert.match((await recordDecision(jira, { issueKey: 'OPS-2', ...refund }, 'a', NOW)).error, /refused to save/);
});

test('find: plural query, project scope, ranking, withdrawn decisions excluded', async () => {
  const jira = fakeJira(); jira.add('OPS-1', 'Refund policy'); jira.add('OPS-2', 'Billing'); jira.add('WEB-1', 'Site');
  await recordDecision(jira, { issueKey: 'OPS-1', ...refund }, 'a', NOW);
  await recordDecision(jira, { issueKey: 'OPS-2', statement: 'Invoices are issued on the first of the month.', rationale: 'Accounting closes books then; refunds are handled separately.' }, 'a', NOW);
  const w = await recordDecision(jira, { issueKey: 'WEB-1', statement: 'The pricing page shows annual prices by default.', rationale: 'Most visitors pick annual plans.' }, 'a', NOW);
  const all = await findDecisions(jira, { query: 'Has anything been decided about refunds for annual plans?' }, NOW);
  assert.equal(all.method, 'index');
  assert.deepEqual(all.decisions.map((d) => d.issueKey), ['OPS-1', 'WEB-1', 'OPS-2']);
  assert.deepEqual(all.decisions[0].matched.sort(), ['annual', 'plans', 'refunds']);
  assert.deepEqual((await findDecisions(jira, { query: 'refunds', projectKey: 'ops' }, NOW)).decisions.map((d) => d.issueKey).sort(), ['OPS-1', 'OPS-2']);
  await withdrawDecision(jira, { issueKey: 'WEB-1', decisionId: w.saved.id });
  assert.ok(!(await findDecisions(jira, { query: 'annual pricing' }, NOW)).decisions.some((d) => d.issueKey === 'WEB-1'));
  assert.equal((await findDecisions(jira, {}, NOW)).decisionCount, 2, 'empty query lists everything in force');
  assert.match((await findDecisions(jira, { query: 'is it ok?' }, NOW)).error, /no distinctive word/);
  assert.match((await findDecisions(jira, { query: 'refund', projectKey: 'bad key!' }, NOW)).error, /not a valid project key/);
  const none = await findDecisions(jira, { query: 'kubernetes cluster' }, NOW);
  assert.equal(none.decisionCount, 0); assert.match(none.note, /not proof that nothing was decided/);
});

test('find falls back to a scan when the index query is rejected', async () => {
  const jira = fakeJira({ indexBroken: true }); jira.add('OPS-1', 'Refund policy'); jira.add('OPS-2', 'Other');
  jira.issues.get('OPS-1').prop = { items: [{ id: 'd-1', statement: refund.statement, rationale: refund.rationale, status: 'active', decidedAt: NOW.toISOString() }], text: 'x', activeCount: 1 };
  const r = await findDecisions(jira, { query: 'refunds' }, NOW);
  assert.match(r.method, /scan/); assert.equal(r.decisionCount, 1);
});

test('recording warns about decisions on other issues that touch the same topic', async () => {
  const jira = fakeJira(); jira.add('OPS-1', 'Refund policy'); jira.add('WEB-9', 'Pricing page');
  await recordDecision(jira, { issueKey: 'OPS-1', ...refund }, 'a', NOW);
  const r = await recordDecision(jira, { issueKey: 'WEB-9', statement: 'The pricing page promises a 60 day refund on annual plans.', rationale: 'Marketing wants a stronger guarantee.' }, 'a', NOW);
  assert.deepEqual(r.relatedElsewhere.map((d) => d.issueKey), ['OPS-1']);
  assert.match(r.note, /does not contradict/);
});

test('review dates: dueOnly lists only decisions whose review date has passed', async () => {
  const jira = fakeJira(); jira.add('OPS-1', 'A'); jira.add('OPS-2', 'B');
  await recordDecision(jira, { issueKey: 'OPS-1', ...refund, reviewBy: '2026-12-01' }, 'a', NOW);
  await recordDecision(jira, { issueKey: 'OPS-2', statement: 'Support hours are nine to six on weekdays.', rationale: 'Ticket volume outside these hours is under two percent.' }, 'a', NOW);
  const later = new Date('2026-12-05T00:00:00Z');
  assert.deepEqual((await findDecisions(jira, { dueOnly: true }, later)).decisions.map((d) => d.issueKey), ['OPS-1']);
  assert.equal((await findDecisions(jira, { dueOnly: 'true' }, NOW)).decisionCount, 0);
  assert.equal((await getDecisions(jira, { issueKey: 'OPS-1' }, later)).decisions[0].reviewDue, true);
});
