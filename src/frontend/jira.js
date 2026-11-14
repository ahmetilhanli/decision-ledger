// Browser-side Jira client for the shared handlers. Same four calls as the backend client, made as the current user.
import { requestJira } from '@forge/bridge';
import { PROPERTY_KEY } from '../decisions.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const jira = {
  async getIssue(issueKey) {
    const res = await requestJira(`/rest/api/3/issue/${issueKey}?fields=summary,status`);
    if (!res.ok) return null;
    const body = await res.json();
    return { key: body.key, summary: body.fields.summary, status: body.fields.status.name };
  },
  async getProperty(issueKey) {
    const res = await requestJira(`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Jira returned ${res.status} while reading decisions.`);
    return (await res.json()).value;
  },
  async putProperty(issueKey, value) {
    const res = await requestJira(`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(value) });
    return res.ok;
  },
  async search(jql, maxResults) {
    const res = await requestJira('/rest/api/3/search/jql', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ jql, maxResults, fields: ['summary', 'status'], properties: [PROPERTY_KEY] }),
    });
    if (!res.ok) return { error: res.status };
    return { issues: (await res.json()).issues || [] };
  },
};
