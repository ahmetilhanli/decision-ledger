// The search box is uncontrolled on purpose: as a controlled UI Kit Textfield it dropped characters while typing.
// Decision Ledger project page: every decision in force in this project, searchable, with the ones due for review on top.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Stack, Inline, Text, Strong, Lozenge, Button, Link, Spinner, SectionMessage, Textfield, DynamicTable, useProductContext,
} from '@forge/react';
import { findDecisions } from '../handlers.js';
import { jira } from './jira.js';

const HEAD = { cells: [
  { key: 'issue', content: 'Issue', width: 10 }, { key: 'decision', content: 'Decision and reason' },
  { key: 'decided', content: 'Decided', width: 10 }, { key: 'review', content: 'Review', width: 14 },
] };

const Log = () => {
  const context = useProductContext();
  const projectKey = context && context.extension && context.extension.project ? context.extension.project.key : null;
  const [query, setQuery] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [result, setResult] = useState(null);   // null = loading
  const [error, setError] = useState(null);
  const [boxKey, setBoxKey] = useState(0);      // bumping it remounts the search box, which is how Clear empties it

  const load = async (q, due) => {
    setError(null); setResult(null);
    try {
      const r = await findDecisions(jira, { projectKey, query: q, dueOnly: due });
      if (r.error) { setError(r.error); setResult({ decisions: [] }); } else setResult(r);
    } catch (e) { setError(e.message); setResult({ decisions: [] }); }
  };

  useEffect(() => { if (projectKey) load('', false); }, [projectKey]);

  if (!projectKey) return <Spinner />;
  const rows = result ? [...result.decisions].sort((a, b) => Number(b.reviewDue) - Number(a.reviewDue)).map((d) => ({
    key: d.id,
    cells: [
      { key: 'issue', content: <Link href={`/browse/${d.issueKey}`} openNewTab>{d.issueKey}</Link> },
      { key: 'decision', content: <Stack space="space.025"><Text><Strong>{d.statement}</Strong></Text><Text>{`Why: ${d.rationale}`}</Text></Stack> },
      { key: 'decided', content: <Text>{String(d.decidedAt || '').slice(0, 10)}</Text> },
      { key: 'review', content: d.reviewBy ? <Lozenge appearance={d.reviewDue ? 'moved' : 'default'}>{d.reviewDue ? `Due ${d.reviewBy}` : d.reviewBy}</Lozenge> : <Text>-</Text> },
    ],
  })) : [];

  return (
    <Stack space="space.200">
      <Text>Decisions in force: what this project has decided and why. Record decisions from the Decision Ledger panel on an issue, or ask the Decision Ledger agent in Rovo.</Text>
      <Inline space="space.100" alignBlock="center">
        <Textfield key={boxKey} placeholder="Search a topic, for example refund policy" onChange={(e) => setQuery(e.target.value)} />
        <Button appearance="primary" onClick={() => load(query, dueOnly)}>Search</Button>
        <Button isSelected={dueOnly} onClick={() => { setDueOnly(!dueOnly); load(query, !dueOnly); }}>Review due only</Button>
        <Button appearance="subtle" isDisabled={!query && !dueOnly} onClick={() => { setQuery(''); setDueOnly(false); setBoxKey(boxKey + 1); load('', false); }}>Clear</Button>
      </Inline>
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      {result === null ? <Spinner /> : error ? null : (
        <DynamicTable head={HEAD} rows={rows} rowsPerPage={20} emptyView={<Text>{query || dueOnly ? 'No decision in force matches. That does not prove nothing was decided; it may not have been recorded.' : 'No decisions recorded in this project yet.'}</Text>} />
      )}
      {result && result.decisions.length ? <Text>{`${result.decisionCount} decision${result.decisionCount === 1 ? '' : 's'} in force${result.decisionCount > 20 ? ' (showing the first 20; search to narrow down)' : ''}.`}</Text> : null}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><Log /></React.StrictMode>);
