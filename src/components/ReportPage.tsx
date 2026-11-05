import { useState, type FormEvent, type ReactNode } from 'react';
import { BETA_RACER_ART } from '../race/testSeason';
import { ApiError, testSeason, type ReportArea, type ReportKind } from '../testSeason/api';
import './report.css';

const MIN = 10, MAX = 2000;

const icon = (d: ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

const KINDS: { id: ReportKind; label: string; hint: string; art: ReactNode; placeholder: string }[] = [
  { id: 'bug', label: 'Bug', hint: 'Something broke', placeholder: 'What did you do, what did you expect, and what happened instead?',
    art: icon(<><rect x="8" y="7" width="8" height="13" rx="4" /><path d="M9.5 7a2.5 2.5 0 0 1 5 0M4 9l4 2M20 9l-4 2M3 14h5M21 14h-5M4 20l4-3M20 20l-4-3" /></>) },
  { id: 'idea', label: 'Idea', hint: 'Make it better', placeholder: 'What would you love to see in Pangs Rally?',
    art: icon(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3Z" /></>) },
  { id: 'other', label: 'Other', hint: 'Anything else', placeholder: 'Tell us what is on your mind.',
    art: icon(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />) },
];

const AREAS: { id: ReportArea; label: string }[] = [
  { id: 'racing', label: 'Racing' },
  { id: 'rooms', label: 'Online rooms' },
  { id: 'wallet', label: 'Wallet & sign-in' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'profile', label: 'Profile' },
  { id: 'other', label: 'Something else' },
];

const TIPS = ['What you were doing', 'What you expected', 'What happened instead'];

export default function ReportPage({ racer, fromPage, onSignIn }: { racer: string | null; fromPage: string; onSignIn: () => void }) {
  const [kind, setKind] = useState<ReportKind>('bug');
  const [area, setArea] = useState<ReportArea | null>(null);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const length = message.trim().length;
  const ready = !!area && length >= MIN && length <= MAX && !sending;
  const active = KINDS.find(k => k.id === kind)!;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !area) return;
    setSending(true);
    setError(null);
    try {
      await testSeason.report({ kind, area, message: message.trim(), contact: contact.trim(), page: fromPage, agent: navigator.userAgent });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your report. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setSent(false);
    setMessage('');
    setArea(null);
    setKind('bug');
  };

  return (
    <section className="rp animated-enter">
      <aside className="rp-intro">
        <div className="rp-art"><img src={BETA_RACER_ART} alt="" /></div>
        <p className="rp-eyebrow">Beta Season</p>
        <h2>Spotted something?</h2>
        <p className="rp-lead">You are testing the game with us. Tell us what broke or what you would love to see.</p>
        <div className="rp-tips">
          <strong>A great bug report has</strong>
          <ol>{TIPS.map((t, i) => <li key={t}><span>{i + 1}</span>{t}</li>)}</ol>
        </div>
      </aside>

      <div className="rp-panel">
        {sent ? (
          <div className="rp-done" role="status">
            <div className="rp-check">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            </div>
            <h3>Thanks, we got it!</h3>
            <p>Your report is with the team. Every note helps us tune the Beta Season.</p>
            <button type="button" className="btn btn-primary" onClick={reset}>Send another</button>
          </div>
        ) : (
          <form onSubmit={send}>
            <fieldset className="rp-field">
              <legend>What would you like to send?</legend>
              <div className="rp-kinds">
                {KINDS.map(k => (
                  <button key={k.id} type="button" className={`rp-kind ${kind === k.id ? 'on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                    {k.art}
                    <strong>{k.label}</strong>
                    <small>{k.hint}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="rp-field">
              <legend>Where is it?</legend>
              <div className="rp-chips">
                {AREAS.map(a => (
                  <button key={a.id} type="button" className={`rp-chip ${area === a.id ? 'on' : ''}`} aria-pressed={area === a.id} onClick={() => setArea(a.id)}>{a.label}</button>
                ))}
              </div>
            </fieldset>

            <label className="rp-field">
              <span className="rp-label">Tell us more</span>
              <textarea rows={6} maxLength={MAX} value={message} onChange={e => setMessage(e.target.value)} placeholder={active.placeholder} />
              <span className={`rp-count ${length > 0 && length < MIN ? 'low' : ''}`}>
                {length > 0 && length < MIN ? `${MIN - length} more characters` : `${length} / ${MAX}`}
              </span>
            </label>

            <label className="rp-field">
              <span className="rp-label">X or Discord <em>optional, if you would like a reply</em></span>
              <input type="text" maxLength={80} value={contact} onChange={e => setContact(e.target.value)} placeholder="@yourname" />
            </label>

            {error && <div className="rp-error" role="alert">{error}</div>}

            <div className="rp-foot">
              <p className="rp-meta">
                {racer
                  ? <>Sent as <strong>{racer}</strong>, with your wallet, the page you were on and your browser.</>
                  : <>You are not signed in. <button type="button" onClick={onSignIn}>Connect your wallet</button> or leave a contact so we can reply. The page you were on and your browser are included.</>}
              </p>
              <button type="submit" className="btn btn-primary rp-send" disabled={!ready}>{sending ? 'Sending…' : 'Send report'}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
