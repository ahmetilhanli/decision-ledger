# Decision Ledger

What was decided, why, and is it still in force. A Forge app for Jira Cloud, built for Codegeist 2026.

Teams re-decide things they already settled, and AI agents build against decisions nobody told them about.
Decision Ledger keeps each decision on the Jira issue where it was made and brings it back when related work starts.

## What it does

- **Issue panel.** Record a decision with its reason, an optional link and an optional review date. Replace or withdraw it later; the history stays.
- **"Already decided elsewhere".** When you open an issue, the panel lists decisions in force on other issues that mention the same topic.
- **Conflict hint.** Saving a decision reports other issues with a decision in force on the same topic, so a contradiction is seen at once.
- **Decision log.** A project page with every decision in force, searchable, with a filter for decisions whose review date has passed.
- **Rovo agent.** "Has anything been decided about refunds?", "Record a decision on OPS-12". Writes go through Rovo's confirmation card.
- **MCP tools and a skill.** `find-decisions`, `get-decisions`, `record-decision` and `withdraw-decision` are declared as `rovo:mcp` tools, with a `SKILL.md` that tells coding agents to check the ledger before they start work.

Decisions are stored in the issue property `decision-ledger`. A `jira:entityProperty` module indexes the active decision text, so search is plain JQL and Jira's own permissions decide who sees what. The app calls no external service.

## Layout

| Path | Purpose |
|---|---|
| `manifest.yml` | Forge modules and scopes (`read:jira-work`, `write:jira-work`) |
| `src/decisions.js` | Validation, supersede logic, keyword and stem matching. No Forge imports |
| `src/handlers.js` | The four actions, written against a small injected Jira client |
| `src/index.js` | Forge entry points (backend Jira client) |
| `src/frontend/` | Issue panel, project page and the browser Jira client (UI Kit) |
| `skills/decision-ledger/SKILL.md` | Skill for agents |
| `tests/` | 17 tests: pure logic and the handlers against an in-memory Jira |

## Run it

Requires the Forge CLI and Node 24. Run `forge register` first so the manifest gets your own app id.

```
npm install
npm test
forge deploy
forge install
```

## Status and limits

- Tested on one live Jira Cloud site: recording from the panel, replace and history, review-date validation, the "already decided elsewhere" box, the conflict hint, the project page search, and the Rovo agent finding and recording a decision.
- Not yet tested: calling the MCP tools from an external agent; the withdraw action through the agent; the scan fallback on a live site (covered by a unit test only).
- Matching is by key words and simple stems, not by meaning. "Refund" finds "refunds"; it does not find "money back". The conflict hint says two decisions share a topic, not that they contradict.
- The search index lags a few seconds behind a save.
- An empty search result means no recorded decision was found. It does not prove nothing was decided.
- One issue holds up to about 30,000 characters of decisions; beyond that the app asks you to use a new issue.
- This project was built with AI coding assistance.

## Privacy, terms, support

See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md). Questions and bug reports: open an issue in this repository.

## License

Apache-2.0. See `LICENSE`.
