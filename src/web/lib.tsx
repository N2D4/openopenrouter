import { useUser } from "@hexclave/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { hexclaveClientApp } from "./hexclave";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      setState({ data, loading: false });
    } catch (error) {
      setState({ error: error as Error, loading: false });
    }
  }, []);
  // biome-ignore lint: deps are passed by the caller
  useEffect(() => {
    void reload();
  }, deps);
  return { ...state, reload };
}

export function Spinner() {
  return (
    <div className="center" role="status" aria-label="Loading">
      <span className="spinner" />
    </div>
  );
}

export function ErrorText({ error }: { error?: Error | null }) {
  if (!error) return null;
  return <p className="error">{error.message}</p>;
}

/** Wrap an async click handler with a loading state and error capture. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = async (...args: A) => {
    setPending(true);
    setError(null);
    try {
      await fn(...args);
    } catch (e) {
      setError(e as Error);
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error, setError };
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useUser();
  useEffect(() => {
    if (!user) void hexclaveClientApp.redirectToSignIn();
  }, [user]);
  if (!user) return <Spinner />;
  return <>{children}</>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
