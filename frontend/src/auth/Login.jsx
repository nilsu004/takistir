import { useEffect, useRef, useState } from 'react';
import { Button, Field, Notice } from '../components.jsx';
import { navigate } from '../data.js';
import { useStore } from '../Store.jsx';
import { safeDestination, signedInDestination } from './model.js';
import './auth.css';

export function Login({ register = false, next = '/account' }) {
  const { login, user, busy, cartSyncError } = useStore();
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const form = useRef(null);
  const destination = safeDestination(next);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function signIn(email, password, name, confirmation, home) {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    setErrors({});
    try {
      const result = await login(email, password, name, confirmation, home);
      if (!active.current) return;
      if (result.error) {
        setError(result.error);
        setErrors(result.fieldErrors || {});
        return;
      }
      form.current?.reset();
      navigate(
        signedInDestination(
          result.state.user,
          destination,
          result.cartError,
          result.profileError,
        ),
      );
    } finally {
      inFlight.current = false;
      if (active.current) setSubmitting(false);
    }
  }
  const waiting = busy || submitting;
  useEffect(() => {
    const field = ['name', 'email', 'password', 'confirmation', 'home'].find(
      (name) => errors[name],
    );
    if (!waiting && field) form.current?.elements.namedItem(field)?.focus();
  }, [errors, waiting]);
  const feedback = (name) => ({
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `auth-${name}-error` : undefined,
  });
  const errorText = (name) =>
    errors[name] && (
      <small className="auth-field-error" id={`auth-${name}-error`}>
        {errors[name]}
      </small>
    );
  return (
    <main className="container page auth-page">
      <div className="panel auth-panel">
        <p className="eyebrow">Takıştır account</p>
        {user ? (
          <>
            <h1>You are signed in</h1>
            <p>
              Continue as {user.name}. To use another account, sign out from
              your account page first.
            </p>
            <a
              className="button"
              href={`#${signedInDestination(user, destination, cartSyncError)}`}
            >
              Continue
            </a>
            <a className="text-button auth-account-link" href="#/account">
              My account
            </a>
          </>
        ) : (
          <>
            <h1>{register ? 'Create an account' : 'Welcome back'}</h1>
            <p className="muted">
              {register
                ? 'Create your customer account to continue shopping.'
                : 'Sign in to continue to your account or workspace.'}
            </p>
            <p className="muted small">
              Items added as a guest will be kept when you sign in or register
              as a customer.
            </p>
            {error && <Notice error>{error}</Notice>}
            <form
              ref={form}
              className="form-stack"
              noValidate
              aria-busy={waiting}
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                await signIn(
                  data.get('email'),
                  data.get('password'),
                  register ? data.get('name') : undefined,
                  register ? data.get('confirmation') : undefined,
                  register ? data.get('home') : undefined,
                );
              }}
              onChange={() => {
                if (error) {
                  setError('');
                  setErrors({});
                }
              }}
            >
              <fieldset className="auth-fields form-stack" disabled={waiting}>
                {register && (
                  <div>
                    <Field
                      label="Full name"
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={160}
                      {...feedback('name')}
                    />
                    {errorText('name')}
                  </div>
                )}
                <div>
                  <Field
                    label="Email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="deniz@example.com"
                    required
                    maxLength={254}
                    {...feedback('email')}
                  />
                  {errorText('email')}
                </div>
                <div>
                  <Field
                    label="Password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      register ? 'new-password' : 'current-password'
                    }
                    minLength={register ? 8 : 1}
                    maxLength={128}
                    required
                    {...feedback('password')}
                  />
                  {errorText('password')}
                </div>
                {register && (
                  <>
                    <p className="muted small auth-password-help">
                      Use 8–128 characters, without spaces at the start or end.
                    </p>
                    <div>
                      <Field
                        label="Confirm password"
                        name="confirmation"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        maxLength={128}
                        required
                        {...feedback('confirmation')}
                      />
                      {errorText('confirmation')}
                    </div>
                  </>
                )}
                <button
                  className="text-button auth-password-toggle"
                  type="button"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? 'Hide password' : 'Show password'}
                </button>
                {register && (
                  <div>
                    <Field
                      label="Home address"
                      name="home"
                      autoComplete="street-address"
                      required
                      maxLength={500}
                      {...feedback('home')}
                    />
                    {errorText('home')}
                  </div>
                )}
                <Button type="submit">
                  {waiting
                    ? 'Please wait…'
                    : register
                      ? 'Create account'
                      : 'Sign in'}
                </Button>
              </fieldset>
              {waiting && (
                <p role="status">Signing in and loading your cart…</p>
              )}
            </form>
            {!register && (
              <details className="preview-tools">
                <summary>Local test accounts</summary>
                <p>
                  Use separate browser profiles or an incognito window to test
                  both roles at once.
                </p>
                <div className="form-stack">
                  <Button
                    secondary
                    disabled={waiting}
                    onClick={() =>
                      signIn('deniz@example.com', 'CustomerDemo!24')
                    }
                  >
                    Use customer demo
                  </Button>
                  <Button
                    secondary
                    disabled={waiting}
                    onClick={() =>
                      signIn('manager@takistir.local', 'ManagerDemo!24')
                    }
                  >
                    Use Product Manager demo
                  </Button>
                </div>
              </details>
            )}
            <p className="auth-switch">
              {register ? 'Already have an account?' : 'New to Takıştır?'}{' '}
              <a
                aria-disabled={waiting}
                href={`#/${register ? 'login' : 'register'}?next=${encodeURIComponent(destination)}`}
                onClick={(event) => {
                  if (waiting) event.preventDefault();
                }}
              >
                {register ? 'Sign in' : 'Create an account'}
              </a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
