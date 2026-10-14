import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, requireSupabase, errorMessage } from "./supabase";
import Login from "./Login";
import Board from "./Board";
import "./App.css";

function AccountGate({ session }: { session: Session }) {
  const [access, setAccess] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    requireSupabase()
      .from("thoughtboard_members")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setAccess(!!data);
      });
    return () => {
      active = false;
    };
  }, [session.user.id, attempt]);
  if (access === true) return <Board userId={session.user.id} />;
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand">Thoughtboard.</div>
        {error ? (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <button
              className="primary-button"
              onClick={() => {
                setError("");
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          </>
        ) : (
          <p>
            {access === null
              ? "Opening your board…"
              : "This account hasn’t been given access to this board. Complete the account setup in the included instructions."}
          </p>
        )}
        <button
          className="small-button"
          onClick={async () => {
            const { error } = await requireSupabase().auth.signOut({
              scope: "local",
            });
            if (error) setError(error.message);
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let sawEvent = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) {
        sawEvent = true;
        setSession(next);
        setReady(true);
        setError("");
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || sawEvent) return;
        if (error) setError(error.message);
        setSession(data.session);
        setReady(true);
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason));
          setReady(true);
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  if (!supabase)
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand">Thoughtboard.</div>
          <p>
            Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to
            .env.local, then restart Vite.
          </p>
        </section>
      </main>
    );
  if (!ready)
    return (
      <main className="auth-page">
        <p>Opening your board…</p>
      </main>
    );
  if (error)
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="error" role="alert">
            {error}
          </p>
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </section>
      </main>
    );
  return session ? (
    <AccountGate key={session.user.id} session={session} />
  ) : (
    <Login />
  );
}
