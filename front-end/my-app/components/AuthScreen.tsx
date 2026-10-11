"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { API_BASE_URL } from "../lib/config";

interface BootstrapForm {
  bootstrapKey: string;
  name: string;
  email: string;
  password: string;
}

interface AuthScreenProps {
  setupStatus: "checking" | "needed" | "done";
  bootstrapForm: BootstrapForm;
  setBootstrapForm: Dispatch<SetStateAction<BootstrapForm>>;
  loginForm: { email: string; password: string };
  setLoginForm: Dispatch<SetStateAction<{ email: string; password: string }>>;
  handleBootstrapAdmin: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleLogin: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
  feedback: string | null;
}

/** First-run setup (fresh install) or sign-in, shown whenever nobody is signed in. */
export default function AuthScreen({
  setupStatus,
  bootstrapForm,
  setBootstrapForm,
  loginForm,
  setLoginForm,
  handleBootstrapAdmin,
  handleLogin,
  busy,
  feedback,
}: AuthScreenProps) {
  return (
    <div className="min-h-screen bg-[#f5f1e8] px-4 py-8 text-[#2f2a21] sm:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-3xl border border-[#e0d7c8] bg-[#fbf8f1] p-8 shadow-[0_12px_30px_rgba(0,0,0,0.06)]">
          <p className="text-xs uppercase tracking-[0.18em] text-[#7d6a4e]">MediAssist IA</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-[#2f2a21]">
            Global + Patient RAG workspace
          </h1>
          <p className="mt-4 max-w-xl text-sm text-[#645841] sm:text-base">
            Chat globally with AI, or switch to a specific patient folder context with its own
            isolated history and patient-scoped RAG.
          </p>
          <div className="mt-8 rounded-2xl border border-[#e7ddcd] bg-white/70 p-4 text-sm text-[#5f513a]">
            API base: <span className="font-medium">{API_BASE_URL}</span>
          </div>
        </section>

        <section className="rounded-3xl border border-[#e0d7c8] bg-[#fbf8f1] p-6 shadow-[0_12px_30px_rgba(0,0,0,0.06)]">
          {setupStatus === "checking" && (
            <p className="py-10 text-center text-sm text-[#7d6a4e]">Connecting to MediAssist...</p>
          )}

          {setupStatus === "needed" && (
            <form className="grid gap-3" onSubmit={handleBootstrapAdmin}>
              <div>
                <h2 className="text-xl font-semibold text-[#2f2a21]">Set up MediAssist</h2>
                <p className="mt-1 text-sm text-[#645841]">
                  No administrator exists yet. Create the first admin account to get started; you can add
                  the rest of your staff from inside the app afterwards.
                </p>
              </div>
              <label className="grid gap-1 text-sm text-[#5f513a]">
                Setup key
                <input
                  className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                  type="password"
                  autoComplete="off"
                  value={bootstrapForm.bootstrapKey}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, bootstrapKey: event.target.value }))
                  }
                  required
                />
                <span className="text-xs text-[#8a7c62]">
                  The <code className="rounded bg-[#efe6d6] px-1">BOOTSTRAP_ADMIN_KEY</code> value from{" "}
                  <code className="rounded bg-[#efe6d6] px-1">back-end/.env</code>. It proves you control the server
                  and is only needed this once.
                </span>
              </label>
              <input
                className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                placeholder="Full name"
                autoComplete="name"
                value={bootstrapForm.name}
                onChange={(event) =>
                  setBootstrapForm((current) => ({ ...current, name: event.target.value }))
                }
                minLength={2}
                required
              />
              <input
                className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                placeholder="Email"
                type="email"
                autoComplete="email"
                value={bootstrapForm.email}
                onChange={(event) =>
                  setBootstrapForm((current) => ({ ...current, email: event.target.value }))
                }
                required
              />
              <input
                className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                placeholder="Password (min 8 characters)"
                type="password"
                autoComplete="new-password"
                value={bootstrapForm.password}
                onChange={(event) =>
                  setBootstrapForm((current) => ({ ...current, password: event.target.value }))
                }
                minLength={8}
                required
              />
              <button
                type="submit"
                className="rounded-xl bg-[#0f5a4f] px-4 py-2 text-sm font-medium text-white"
                disabled={busy}
              >
                {busy ? "Setting up..." : "Create admin and sign in"}
              </button>
            </form>
          )}

          {setupStatus === "done" && (
            <form className="grid gap-3" onSubmit={handleLogin}>
              <h2 className="text-xl font-semibold text-[#2f2a21]">Sign in</h2>
              <input
                className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                placeholder="Email"
                type="email"
                autoComplete="username"
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, email: event.target.value }))
                }
                required
              />
              <input
                className="rounded-xl border border-[#d8cfbe] bg-white px-3 py-2 text-sm"
                placeholder="Password"
                type="password"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
                required
              />
              <button
                type="submit"
                className="rounded-xl bg-[#0f5a4f] px-4 py-2 text-sm font-medium text-white"
                disabled={busy}
              >
                {busy ? "Signing in..." : "Sign in"}
              </button>
              <p className="text-xs text-[#8a7c62]">
                No account yet? Ask your administrator to create one for you.
              </p>
            </form>
          )}

          {feedback && (
            <p className="mt-4 rounded-xl border border-[#e3d8c6] bg-[#fffdf8] px-3 py-2 text-sm text-[#6e5b40]">
              {feedback}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
