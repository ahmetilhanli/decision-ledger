// Decision Ledger handlers. They talk to Jira through a small injected client so they can be tested without Forge:
//   jira.getIssue(key) -> { key, summary, status } | null       jira.getProperty(key) -> value | null
//   jira.putProperty(key, value) -> true | false                 jira.search(jql, max) -> { issues } | { error: status }
import { PROPERTY_KEY, buildDecision, itemsOf, activeOf, toProperty, supersede, keywords, matches, reviewDue, textClause } from './decisions.js';

const key = (v) => String(v || '').trim().toUpperCase();
const validKey = (k) => /^[A-Z][A-Z0-9_]{1,19}-\d+$/.test(k);
const validProject = (p) => /^[A-Z][A-Z0-9_]{1,19}$/.test(p);
const count = (items) => items.filter((i) => i.status === 'active').length;

async function open(jira, rawKey) {
  const issueKey = key(rawKey);
  if (!validKey(issueKey)) return { error: `"${rawKey || ''}" is not a Jira issue key. It looks like OPS-12.` };
  const issue = await jira.getIssue(issueKey);
  // Checked first so that a missing property is not mistaken for "no decisions" on an issue the caller cannot see.
  if (!issue) return { error: `Issue ${issueKey} was not found or you cannot see it.` };
  return { issueKey, issue };
}

async function save(jira, issueKey, items) {
  const { value, error } = toProperty(items);
  if (error) return error;
  return (await jira.putProperty(issueKey, value)) ? null : `Jira refused to save the decisions on ${issueKey}. You may not have permission to edit this issue.`;
}

// Flattens search results into active decisions that match the words, best match first.
function collect(issues, words, skipKey, now) {
  const out = [];
  for (const i of issues) {
    if (i.key === skipKey) continue;
    for (const d of activeOf(i.properties ? i.properties[PROPERTY_KEY] : null)) {
      const hit = matches(d, words);
      if (words.length && !hit.length) continue;
      out.push({ issueKey: i.key, issueSummary: i.fields.summary, id: d.id, statement: d.statement, rationale: d.rationale, url: d.url, decidedAt: d.decidedAt, reviewBy: d.reviewBy || null, reviewDue: reviewDue(d, now), matched: hit });
    }
  }
  return out.sort((a, b) => b.matched.length - a.matched.length || String(b.decidedAt).localeCompare(String(a.decidedAt)));
}

// Indexed search first. The index lags a few seconds behind writes and can be missing right after install,
// so if Jira rejects the query the function falls back to reading the most recently updated issues directly.
async function searchDecisions(jira, scope, words) {
  const text = words.length ? ` AND ${textClause(words)}` : '';
  let found = await jira.search(`${scope}activeDecisions > 0${text} ORDER BY updated DESC`, 50);
  if (!found.error) return { issues: found.issues, method: 'index' };
  found = await jira.search(`${scope}updated >= -90d ORDER BY updated DESC`, 50);
  if (found.error) return { error: `Jira returned ${found.error} while searching.` };
  return { issues: found.issues, method: 'scan of the 50 most recently updated issues' };
}

// Action: show the decisions recorded on an issue.
export async function getDecisions(jira, payload, now = new Date()) {
  const o = await open(jira, payload.issueKey);
  if (o.error) return o;
  const items = itemsOf(await jira.getProperty(o.issueKey)).map((d) => ({ ...d, reviewDue: reviewDue(d, now) }));
  return { issue: o.issue, activeCount: count(items), decisions: items };
}

// Action: record a decision on an issue. If `supersedesId` is given, that earlier decision on the same issue is retired.
// The answer also lists decisions in force on other issues that touch the same topic, so a contradiction is seen at once.
export async function recordDecision(jira, payload, accountId, now = new Date()) {
  const o = await open(jira, payload.issueKey);
  if (o.error) return o;
  const { item, error } = buildDecision(payload, accountId, now);
  if (error) return { error };

  let items = itemsOf(await jira.getProperty(o.issueKey));
  if (items.some((i) => i.status === 'active' && i.statement.toLowerCase() === item.statement.toLowerCase())) {
    return { error: `The same decision is already in force on ${o.issueKey}. Nothing was saved.` };
  }
  const old = String(payload.supersedesId || '').trim();
  if (old) {
    const r = supersede(items, old, item.id);
    if (r.error) return { error: r.error };
    items = r.items;
  }
  items = [...items, item];
  const failed = await save(jira, o.issueKey, items);
  if (failed) return { error: failed };

  const words = keywords(`${item.statement}`, 6);
  let related = [];
  if (words.length) {
    const found = await searchDecisions(jira, '', words);
    if (!found.error) related = collect(found.issues, words, o.issueKey, now).slice(0, 5);
  }
  return {
    issue: o.issue, saved: item, superseded: old || null, activeCount: count(items), relatedElsewhere: related,
    note: related.length ? 'Decisions in force on other issues mention the same topic. Check that the new decision does not contradict them.' : 'No other decision in force mentions this topic.',
  };
}

// Action: retire a decision without replacing it.
export async function withdrawDecision(jira, payload) {
  const o = await open(jira, payload.issueKey);
  if (o.error) return o;
  const r = supersede(itemsOf(await jira.getProperty(o.issueKey)), String(payload.decisionId || '').trim());
  if (r.error) return { error: r.error };
  const failed = await save(jira, o.issueKey, r.items);
  if (failed) return { error: failed };
  return { issue: o.issue, withdrawn: String(payload.decisionId).trim(), activeCount: count(r.items) };
}

// Action: find decisions in force. With a query, returns the ones that mention its key words; without, the most recent ones.
export async function findDecisions(jira, payload, now = new Date()) {
  const project = key(payload.projectKey);
  if (project && !validProject(project)) return { error: `"${project}" is not a valid project key.` };
  const query = String(payload.query || '').trim();
  const words = keywords(query, 6);
  if (query && !words.length) return { error: 'The query has no distinctive word of four letters or more. Search with the nouns of the topic, for example "refund policy".' };

  const found = await searchDecisions(jira, project ? `project = "${project}" AND ` : '', words);
  if (found.error) return { error: found.error };
  let decisions = collect(found.issues, words, null, now);
  if (payload.dueOnly === true || payload.dueOnly === 'true') decisions = decisions.filter((d) => d.reviewDue);
  return {
    searchedFor: words, method: found.method, decisionCount: decisions.length, decisions: decisions.slice(0, 20),
    note: decisions.length
      ? 'Only decisions that are still in force are listed. reviewDue marks decisions whose review date has passed.'
      : 'No decision in force matches. That is not proof that nothing was decided; it may not have been recorded.',
  };
}
