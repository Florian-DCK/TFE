"use client";

import { login } from "@/app/actions/auth";
import { useActionState } from "react";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action}>
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
      </div>
      {state?.errors?.email && <p>{state.errors.email.join(", ")}</p>}
      <div>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required />
      </div>
      {state?.errors?.password && <p>{state.errors.password.join(", ")}</p>}
      {state?.message && <p>{state.message}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Connexion..." : "Login"}
      </button>
    </form>
  );
}
