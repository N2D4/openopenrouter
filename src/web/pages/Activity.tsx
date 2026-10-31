import { useState } from "react";
import { fmtInt, internal, usd } from "../api";
import { ErrorText, Spinner, useAction, useAsync } from "../lib";
import { SpendChart } from "../SpendChart";

const WINDOW = 30;

export function Activity() {
  const me = useAsync(() => internal("/me"));
  const activity = useAsync(() => internal<{ daily: any[]; by_model: any[] }>(`/activity?days=${WINDOW}`));
  const first = useAsync(() => internal<{ data: any[]; next_before: number | null }>("/generations?limit=50"));
  const [more, setMore] = useState<any[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const nextBefore = cursor === undefined ? first.data?.next_before : cursor;
  const loadMore = useAction(async () => {
    const r = await internal<{ data: any[]; next_before: number | null }>(`/generations?limit=50&before=${nextBefore}`);
    setMore((m) => [...m, ...r.data]);
    setCursor(r.next_before);
  });
  const rows = [...(first.data?.data ?? []), ...more];
  const spend = activity.data?.daily.reduce((a, d) => a + d.cost, 0) ?? 0;
  const requests = activity.data?.daily.reduce((a, d) => a + d.requests, 0) ?? 0;

  return (
    <>
      <h1>Activity</h1>
      <ErrorText error={activity.error ?? first.error ?? me.error} />
      <div className="grid cols-3" style={{ marginTop: 12 }}>
        <div className="card stat">
          <div className="label">Balance</div>
          <div className="value">{me.data ? usd(me.data.balance) : "–"}</div>
        </div>
        <div className="card stat">
          <div className="label">Spend</div>
          <div className="value">{activity.data ? usd(spend) : "–"}</div>
          <div className="sub">last {WINDOW} days</div>
        </div>
        <div className="card stat">
          <div className="label">Requests</div>
          <div className="value">{activity.data ? fmtInt(requests) : "–"}</div>
          <div className="sub">last {WINDOW} days</div>
        </div>
      </div>

      <h2>Daily spend</h2>
      <div className="card pad">{activity.loading && !activity.data ? <Spinner /> : <SpendChart days={activity.data?.daily ?? []} windowDays={WINDOW} />}</div>

      {activity.data?.by_model.length ? (
        <>
          <h2>By model</h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Requests</th>
                  <th className="num">Prompt tokens</th>
                  <th className="num">Completion tokens</th>
                  <th className="num">Spend</th>
                </tr>
              </thead>
              <tbody>
                {activity.data.by_model.map((m) => (
                  <tr key={m.model}>
                    <td className="mono">{m.model}</td>
                    <td className="num">{fmtInt(m.requests)}</td>
                    <td className="num">{fmtInt(m.prompt_tokens ?? 0)}</td>
                    <td className="num">{fmtInt(m.completion_tokens ?? 0)}</td>
                    <td className="num">{usd(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2>Recent requests</h2>
      <div className="card table-wrap">
        {first.loading && !first.data ? (
          <Spinner />
        ) : rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Key / app</th>
                <th className="num">Tokens</th>
                <th className="num">Cost</th>
                <th className="num">Speed</th>
                <th>Finish</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} title={g.id}>
                  <td className="small">{new Date(g.created_at).toLocaleString()}</td>
                  <td className="mono">{g.model}</td>
                  <td className="small">
                    {g.key_name ?? <span className="faint">deleted key</span>}
                    {g.app_title && <div className="faint">{g.app_title}</div>}
                  </td>
                  <td className="num small">
                    {fmtInt(g.tokens_prompt)} → {fmtInt(g.tokens_completion)}
                  </td>
                  <td className="num">{usd(g.total_cost)}</td>
                  <td className="num small faint">
                    {g.generation_time != null ? `${(g.generation_time / 1000).toFixed(1)}s` : "–"}
                    {g.tokens_completion > 0 && g.generation_time > 0 ? ` · ${Math.round(g.tokens_completion / (g.generation_time / 1000))} tps` : ""}
                  </td>
                  <td className="small">
                    {g.error ? <span className="badge bad" title={g.error}>error</span> : (g.finish_reason ?? "–")}
                    {g.cancelled ? <span className="faint"> (cancelled)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No requests yet.</div>
        )}
      </div>
      {nextBefore != null && (
        <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button type="button" className="btn" disabled={loadMore.pending} onClick={() => loadMore.run()}>
            {loadMore.pending ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
      <ErrorText error={loadMore.error} />
    </>
  );
}
