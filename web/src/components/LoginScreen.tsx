import { useState } from 'react';
import { ApiError, api } from '../api/client.ts';
import type { UserDTO } from '../../../shared/contract.ts';
import { ErrorBox, Field } from './ui.tsx';

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: UserDTO) => void }) {
  const [email, setEmail] = useState('priya@leucine.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login({ email, password });
      onSignedIn(res.data);
    } catch (err) {
      // The input stays exactly as the user typed it: a failed submit must not
      // cost them their work.
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (path: string): string | undefined =>
    error instanceof ApiError ? error.forField(path) : undefined;

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-brand">
          <span className="eyebrow">Equipment</span>
          <h1>Cleaning Log</h1>
          <p className="muted">Sign in to record and verify equipment cleaning.</p>
        </div>

        {error ? <ErrorBox error={error} /> : null}

        <Field label="Email" htmlFor="email" error={fieldError('email')}>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Password" htmlFor="password" error={fieldError('password')}>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="login-hint">
          <strong>Seeded accounts</strong> — password <code>password123</code>
          <table>
            <tbody>
              <tr>
                <td>priya@leucine.test</td>
                <td>operator</td>
              </tr>
              <tr>
                <td>ravi@leucine.test</td>
                <td>supervisor — can verify</td>
              </tr>
              <tr>
                <td>divya@leucine.test</td>
                <td>admin</td>
              </tr>
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
