// Decision Ledger issue panel: the decisions made on this issue, and decisions in force elsewhere that touch the same topic.
// Built with Forge UI Kit. Uses the same handlers as the Rovo actions, running as the current user.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Stack, Inline, Text, Strong, Lozenge, Button, Link, Spinner, SectionMessage,
  Form, FormSection, FormFooter, Label, Textfield, TextArea, useForm, useProductContext,
} from '@forge/react';
import { getDecisions, recordDecision, withdrawDecision, findDecisions } from '../handlers.js';
import { jira } from './jira.js';

const day = (iso) => String(iso || '').slice(0, 10);

// The form lives in its own component so every opening starts empty. Kept in the panel, a second decision
// silently inherited the link and review date typed for the first one (found in live testing).
const DecisionForm = ({ replacing, busy, onSave, onCancel }) => {
  const { handleSubmit, register, getFieldId } = useForm();
  return (
    <Form onSubmit={handleSubmit(onSave)}>
      <FormSection>
        <Stack space="space.100">
          {replacing ? <Text>This replaces the decision above. The old one is kept in the history.</Text> : null}
          <Label labelFor={getFieldId('statement')}>What was decided</Label>
          <TextArea {...register('statement', { required: true })} />
          <Label labelFor={getFieldId('rationale')}>Why (reason, trade-off, evidence)</Label>
          <TextArea {...register('rationale', { required: true })} />
          <Label labelFor={getFieldId('url')}>Link to notes or thread (optional)</Label>
          <Textfield {...register('url')} placeholder="https://" />
          <Label labelFor={getFieldId('reviewBy')}>Review by (optional, YYYY-MM-DD)</Label>
          <Textfield {...register('reviewBy')} placeholder="2027-01-31" />
        </Stack>
      </FormSection>
      <FormFooter>
        <Button isDisabled={busy} onClick={onCancel}>Cancel</Button>
        <Button appearance="primary" type="submit" isDisabled={busy}>Save decision</Button>
      </FormFooter>
    </Form>
  );
};

const Panel = () => {
  const context = useProductContext();
  const issueKey = context && context.extension && context.extension.issue ? context.extension.issue.key : null;
  const [items, setItems] = useState(null);     // null = still loading
  const [related, setRelated] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(null);   // null = closed, '' = new decision, 'd-…' = replacing that decision
  const [showOld, setShowOld] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const r = await getDecisions(jira, { issueKey });
    if (r.error) throw new Error(r.error);
    setItems(r.decisions);
    // Decisions in force on other issues that mention the key words of this issue's summary.
    const f = await findDecisions(jira, { query: r.issue.summary });
    setRelated(f.error ? [] : f.decisions.filter((d) => d.issueKey !== issueKey).slice(0, 5));
  };

  useEffect(() => {
    if (!issueKey) return;
    reload().catch((e) => setError(e.message));
  }, [issueKey]);

  const run = async (fn) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      const r = await fn();
      if (r.error) { setError(r.error); return false; }
      if (r.relatedElsewhere && r.relatedElsewhere.length) {
        setNotice(`Saved. Check it against ${r.relatedElsewhere.map((d) => d.issueKey).join(', ')}: a decision in force there mentions the same topic.`);
      }
      await reload();
      return true;
    } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };

  const onSubmit = async (data) => {
    const ok = await run(() => recordDecision(jira, { issueKey, ...data, supersedesId: adding || '' }, context.accountId));
    if (ok) setAdding(null);
  };

  if (!issueKey || items === null) return error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : <Spinner />;

  const active = items.filter((i) => i.status === 'active');
  const old = items.filter((i) => i.status !== 'active');

  return (
    <Stack space="space.200">
      {related.length ? (
        <SectionMessage appearance="information" title={`Already decided elsewhere (${related.length})`}>
          <Stack space="space.100">
            {related.map((r) => (
              <Stack key={r.id} space="space.025">
                <Text><Link href={`/browse/${r.issueKey}`} openNewTab>{r.issueKey}</Link>{`  ${r.statement}`}</Text>
                <Text>{`Why: ${r.rationale}`}</Text>
              </Stack>
            ))}
          </Stack>
        </SectionMessage>
      ) : null}

      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={active.length ? 'success' : 'default'} isBold>{active.length ? `${active.length} in force` : 'No decisions'}</Lozenge>
        <Text>{active.length ? 'Decisions made on this issue.' : 'Nothing has been decided on this issue yet.'}</Text>
      </Inline>

      {active.map((d) => (
        <Stack key={d.id} space="space.050">
          <Text><Strong>{d.statement}</Strong></Text>
          <Text>{`Why: ${d.rationale}`}</Text>
          <Inline space="space.100" alignBlock="center">
            <Text>{day(d.decidedAt)}</Text>
            {d.reviewBy ? <Lozenge appearance={d.reviewDue ? 'moved' : 'default'}>{d.reviewDue ? `Review due ${d.reviewBy}` : `Review by ${d.reviewBy}`}</Lozenge> : null}
            {d.url ? <Link href={d.url} openNewTab>Open link</Link> : null}
            <Button appearance="subtle" spacing="compact" isDisabled={busy} onClick={() => { setAdding(d.id); setError(null); setNotice(null); }}>Replace</Button>
            <Button appearance="subtle" spacing="compact" isDisabled={busy} onClick={() => run(() => withdrawDecision(jira, { issueKey, decisionId: d.id }))}>Withdraw</Button>
          </Inline>
        </Stack>
      ))}

      {old.length ? (
        <Stack space="space.050">
          <Inline><Button appearance="subtle" spacing="compact" onClick={() => setShowOld(!showOld)}>{`${showOld ? 'Hide' : 'Show'} ${old.length} no longer in force`}</Button></Inline>
          {showOld ? old.map((d) => (
            <Stack key={d.id} space="space.025">
              <Inline space="space.100" alignBlock="center">
                <Lozenge>{d.supersededBy ? 'Replaced' : 'Withdrawn'}</Lozenge>
                <Text>{day(d.decidedAt)}</Text>
              </Inline>
              <Text>{d.statement}</Text>
            </Stack>
          )) : null}
        </Stack>
      ) : null}

      {notice ? <SectionMessage appearance="warning"><Text>{notice}</Text></SectionMessage> : null}
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}

      {adding !== null ? (
        <DecisionForm key={adding || 'new'} replacing={!!adding} busy={busy} onSave={onSubmit} onCancel={() => { setAdding(null); setError(null); }} />
      ) : (
        <Inline><Button appearance={active.length ? 'default' : 'primary'} onClick={() => { setAdding(''); setNotice(null); }}>Record a decision</Button></Inline>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><Panel /></React.StrictMode>);
