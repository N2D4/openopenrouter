import { useUser } from "@hexclave/react";
import { useSearchParams } from "react-router";
import { internal, usd } from "../api";
import { hexclaveClientApp } from "../hexclave";
import { ErrorText, useAction } from "../lib";

/** OAuth PKCE consent screen: /auth?callback_url=...&code_challenge=...&code_challenge_method=S256 */
export function Authorize() {
  const user = useUser();
  const [params] = useSearchParams();
  const callback = params.get("callback_url");
  let host: string | null = null;
  try {
    host = callback ? new URL(callback).host : null;
  } catch {
    host = null;
  }
  const limit = params.get("limit");
  const approve = useAction(async () => {
    const res = await internal<{ redirect_url: string }>("/auth-codes", {
      method: "POST",
      body: {
        callback_url: callback,
        code_challenge: params.get("code_challenge") ?? undefined,
        code_challenge_method: params.get("code_challenge_method") ?? undefined,
        key_label: params.get("key_label") ?? undefined,
        limit: limit != null ? Number(limit) : undefined,
        usage_limit_type: params.get("usage_limit_type") ?? undefined,
        expires_at: params.get("expires_at") ?? undefined,
      },
    });
    window.location.assign(res.redirect_url);
  });

  if (!host) {
    return (
      <main className="page narrow">
        <h1>Invalid request</h1>
        <p className="muted">This authorization link is missing a valid callback_url.</p>
      </main>
    );
  }
  return (
    <main className="page narrow" style={{ maxWidth: 520 }}>
      <div className="card pad" style={{ marginTop: 40 }}>
        <h1 style={{ fontSize: 24 }}>Connect {host}</h1>
        <p className="muted">
          <strong>{host}</strong> is asking for an API key that spends credits from your {__SITE_NAME__} account
          {limit ? `, limited to ${usd(Number(limit))}` : ""}. You can revoke it at any time on the Keys page.
        </p>
        {user ? (
          <>
            <p className="faint small">Signed in as {user.primaryEmail ?? user.displayName}</p>
            <ErrorText error={approve.error} />
            <div className="row" style={{ marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => window.history.back()}>
                Cancel
              </button>
              <span className="spacer" />
              <button type="button" className="btn primary" disabled={approve.pending} onClick={() => approve.run()}>
                {approve.pending ? "Authorizing…" : "Authorize"}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn primary" onClick={() => hexclaveClientApp.redirectToSignIn()}>
            Sign in to continue
          </button>
        )}
      </div>
    </main>
  );
}
