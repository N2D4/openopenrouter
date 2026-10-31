import { useRef, useState } from "react";
import { internal, timeAgo, usd } from "../api";
import { CopyButton, ErrorText, Spinner, useAction, useAsync } from "../lib";

type Key = {
  hash: string;
  name: string;
  label: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_monthly: number;
  is_management_key: boolean;
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
};

function KeyForm({ initial, onSubmit, submitLabel, allowManagement }: { initial?: Partial<Key>; onSubmit: (body: any) => Promise<void>; submitLabel: string; allowManagement?: boolean }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [limit, setLimit] = useState(initial?.limit != null ? String(initial.limit) : "");
  const [reset, setReset] = useState(initial?.limit_reset ?? "");
  const [expires, setExpires] = useState("");
  const [management, setManagement] = useState(false);
  const action = useAction(async () => {
    const body: any = { name, limit: limit === "" ? null : Number(limit), limit_reset: reset || null };
    if (expires) body.expires_at = new Date(`${expires}T23:59:59Z`).toISOString();
    if (management) body.is_management = true;
    await onSubmit(body);
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void action.run();
      }}
    >
      <div className="field">
        <label htmlFor="k-name">Name</label>
        <input id="k-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production" />
      </div>
      <div className="grid cols-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="field">
          <label htmlFor="k-limit">Credit limit (USD, optional)</label>
          <input id="k-limit" type="number" min="0" step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" />
        </div>
        <div className="field">
          <label htmlFor="k-reset">Limit resets</label>
          <select id="k-reset" value={reset} onChange={(e) => setReset(e.target.value)}>
            <option value="">Never</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>
      {!initial && (
        <div className="field">
          <label htmlFor="k-exp">Expires (optional)</label>
          <input id="k-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
      )}
      {allowManagement && (
        <label className="row" style={{ fontWeight: 400 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={management} onChange={(e) => setManagement(e.target.checked)} />
          Management key (can create and manage other keys through the API, but cannot run inference)
        </label>
      )}
      <ErrorText error={action.error} />
      <div className="row" style={{ marginTop: 16 }}>
        <span className="spacer" />
        <button className="btn primary" disabled={action.pending}>
          {action.pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function Keys() {
  const { data, error, loading, reload } = useAsync(() => internal<{ data: Key[] }>("/keys"));
  const createRef = useRef<HTMLDialogElement>(null);
  const editRef = useRef<HTMLDialogElement>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [editing, setEditing] = useState<Key | null>(null);
  const toggle = useAction(async (k: Key) => {
    await internal(`/keys/${k.hash}`, { method: "PATCH", body: { disabled: !k.disabled } });
    await reload();
  });
  const del = useAction(async (k: Key) => {
    if (!confirm(`Delete the key "${k.name}"? Apps using it will stop working immediately.`)) return;
    await internal(`/keys/${k.hash}`, { method: "DELETE" });
    await reload();
  });

  return (
    <>
      <div className="row">
        <h1>API keys</h1>
        <span className="spacer" />
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setCreated(null);
            createRef.current?.showModal();
          }}
        >
          Create key
        </button>
      </div>
      <p className="muted">Keys authenticate requests to the API. Each key can have its own spending limit. Only a hash of each key is stored.</p>
      <ErrorText error={error ?? toggle.error ?? del.error} />
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="card table-wrap">
          {data?.data.length ? (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th className="num">Usage</th>
                  <th className="num">Limit</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((k) => (
                  <tr key={k.hash}>
                    <td>
                      {k.name} {k.is_management_key && <span className="badge accent">management</span>} {k.disabled && <span className="badge bad">disabled</span>}
                    </td>
                    <td className="mono faint">{k.label}</td>
                    <td className="num">{usd(k.usage)}</td>
                    <td className="num">
                      {k.limit == null ? <span className="faint">None</span> : `${usd(k.limit_remaining ?? 0)} of ${usd(k.limit)}`}
                      {k.limit_reset && <div className="faint small">resets {k.limit_reset}</div>}
                    </td>
                    <td className="faint small">{timeAgo(k.last_used_at)}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            setEditing(k);
                            editRef.current?.showModal();
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn small" disabled={toggle.pending} onClick={() => toggle.run(k)}>
                          {k.disabled ? "Enable" : "Disable"}
                        </button>
                        <button type="button" className="btn small danger" disabled={del.pending} onClick={() => del.run(k)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No API keys yet. Create one to start making requests.</div>
          )}
        </div>
      )}

      <dialog ref={createRef} onClose={() => void reload()}>
        {created ? (
          <>
            <h2 style={{ marginTop: 0 }}>Your new API key</h2>
            <p className="muted">Copy it now. For security, it will not be shown again.</p>
            <div className="secret">
              <span style={{ flex: 1 }}>{created}</span>
              <CopyButton text={created} />
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <span className="spacer" />
              <button type="button" className="btn primary" onClick={() => createRef.current?.close()}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>Create API key</h2>
            <KeyForm
              submitLabel="Create"
              allowManagement
              onSubmit={async (body) => {
                const res = await internal<{ key: string }>("/keys", { method: "POST", body });
                setCreated(res.key);
              }}
            />
          </>
        )}
      </dialog>

      <dialog ref={editRef}>
        {editing && (
          <>
            <h2 style={{ marginTop: 0 }}>Edit {editing.name}</h2>
            <KeyForm
              key={editing.hash}
              initial={editing}
              submitLabel="Save"
              onSubmit={async (body) => {
                await internal(`/keys/${editing.hash}`, { method: "PATCH", body });
                editRef.current?.close();
                await reload();
              }}
            />
          </>
        )}
      </dialog>
    </>
  );
}
