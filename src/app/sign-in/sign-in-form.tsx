"use client";

import { useActionState } from "react";

import { signIn, type SignInState } from "./actions";

const initial: SignInState = { message: null, email: "" };

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="card stack">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.message ? (
        <p className="notice small notice-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button className="button button-block" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
