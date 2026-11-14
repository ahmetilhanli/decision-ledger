// Decision Ledger: Forge entry points. Wires the handlers to Jira as the current user.
import api, { route } from '@forge/api';
import { PROPERTY_KEY } from './decisions.js';
import * as h from './handlers.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Jira client for the handlers. Every call runs as the user, so Jira's own permissions decide what is visible.
const jira = {
  async getIssue(issueKey) {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,status`);
    if (!res.ok) return null;
    const body = await res.json();
    return { key: body.key, summary: body.fields.summary, status: body.fields.status.name };
  },
  async getProperty(issueKey) {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Jira returned ${res.status} while reading decisions for ${issueKey}`);
    return (await res.json()).value;
  },
  async putProperty(issueKey, value) {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(value) });
    return res.ok;
  },
  async search(jql, maxResults) {
    const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ jql, maxResults, fields: ['summary', 'status'], properties: [PROPERTY_KEY] }),
    });
    if (!res.ok) return { error: res.status };
    return { issues: (await res.json()).issues || [] };
  },
};

const accountOf = (context) => (context && context.principal ? context.principal.accountId : null);

// A handler must never throw at the agent: it reports the failure as data instead.
const safe = (fn) => async (payload, context) => {
  try { return await fn(payload || {}, context); }
  catch (e) { console.error(e); return { error: `Decision Ledger could not complete the request: ${e.message}` }; }
};

export const getDecisions = safe((payload) => h.getDecisions(jira, payload));
export const recordDecision = safe((payload, context) => h.recordDecision(jira, payload, accountOf(context)));
export const withdrawDecision = safe((payload) => h.withdrawDecision(jira, payload));
export const findDecisions = safe((payload) => h.findDecisions(jira, payload));
