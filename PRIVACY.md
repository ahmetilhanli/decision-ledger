# Decision Ledger — Privacy Policy

Last updated: 14 November 2026. Publisher: Amalfi (amalfi.digital).

## What the app stores

Decision Ledger stores decision records in your own Jira Cloud site, as an issue property named `decision-ledger` on each issue. A record contains: the decision statement, its rationale, an optional link, an optional review date, its status, the time it was recorded, and the Atlassian account ID of the user who recorded it.

## Where data goes

- The app runs on Atlassian Forge and talks only to the Jira REST API of the site it is installed on.
- It sends no data to the publisher or to any third party. It has no external network access, no analytics and no tracking.
- The publisher cannot read your issues or your decision records.

## What it reads

To work, the app reads an issue's summary and status, its `decision-ledger` property, and searches issues that hold decisions. Every read and write runs as the current user, so Jira's permissions apply. It uses the scopes `read:jira-work` and `write:jira-work`.

## Retention and deletion

Records stay in your Jira site until you delete them. Deleting an issue deletes its records. Uninstalling the app stops all access; issue properties can then be removed through the Jira REST API by a site administrator.

## Contact

Open an issue at https://github.com/ahmetilhanli/decision-ledger/issues.
