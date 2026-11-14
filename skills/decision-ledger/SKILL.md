---
name: decision-ledger
description: Use before starting work on a Jira issue, before proposing an approach, and whenever a choice is made that others will rely on. Checks whether the topic was already decided and records new decisions with their reason.
---

# Decision Ledger

Teams re-decide things they already settled, and agents build against decisions nobody told them about.
The ledger keeps each decision on the Jira issue where it was made: what was decided, why, and whether it is
still in force.

## When to use
- You are about to start work on an issue, or to propose a design, a tool or a policy.
- Someone asks "did we decide this?" or "why are we doing it this way?".
- A choice was just made in the conversation that later work depends on.

## Steps
1. Before acting, call `find-decisions` with the key nouns of the topic (and the project key if you know it).
2. If a decision in force covers the topic, follow it. Quote its statement and issue key in your answer. If you
   think it is wrong, say so and ask; do not silently work around it.
3. If nothing is found, say that no recorded decision was found. That is not the same as "nothing was decided".
4. When a decision is made, call `record-decision` with the issue key, a one or two sentence statement and the
   rationale. If it replaces an earlier decision on the same issue, pass that decision's id as `supersedesId`.
5. Use `get-decisions` to see the full history of one issue, and `withdraw-decision` to retire a decision that no
   longer applies.

## Rules
- Never invent a decision or a rationale. Record only what a person decided or confirmed.
- Never say something was decided unless a tool returned it.
- Report exactly what the tools return, including errors.
