import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import ConnectionBadge from './ConnectionBadge.jsx';
import { Field, FormError } from './ui.jsx';
import '../signin.css';

export default function SignIn() {
  const { signIn, notice } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your ID and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err.message || 'Could not sign in. Try again.');
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <main className="signin-screen" id="main">
      <section className="signin-card" aria-labelledby="signin-title">
        <div className="signin-brand">
          <span className="app-mark" aria-hidden="true" />
          <span>Kinara <strong>Relief</strong></span>
        </div>
        <p className="eyebrow">Sindh flood relief coordination</p>
        <h1 id="signin-title">Sign in</h1>
        <p className="page-intro">Use the ID and password issued to you by the relief coordination office.</p>

        <form className="signin-form" onSubmit={submit} noValidate>
          {notice && !error && <p className="form-note" role="status">{notice}</p>}
          <FormError>{error}</FormError>
          <Field label="ID">
            {(p) => <input {...p} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" autoFocus />}
          </Field>
          <Field label="Password">
            {(p) => (
              <span className="pw-row">
                <input {...p} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
              </span>
            )}
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
        </form>

        <div className="signin-foot">
          <ConnectionBadge />
          <p>Authorised staff and volunteers only. Everything you do is limited to your role.</p>
        </div>
      </section>
    </main>
  );
}
