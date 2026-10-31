import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { internal, usd } from "../api";
import { ErrorText, Spinner, useAction, useAsync } from "../lib";

const PACKS = [
  { id: "credits_5usd", amount: 5, price: 5.28 },
  { id: "credits_10usd", amount: 10, price: 10.55 },
  { id: "credits_25usd", amount: 25, price: 26.38 },
  { id: "credits_100usd", amount: 100, price: 105.5 },
];

export function Credits() {
  const [params, setParams] = useSearchParams();
  const [claimed, setClaimed] = useState<number | null>(null);
  // Claim purchased credits on every visit; this also covers returning from checkout.
  const account = useAsync(async () => {
    try {
      const r = await internal<{ claimed: number; account: any }>("/credits/claim", { method: "POST", body: {} });
      if (r.claimed > 0) setClaimed(r.claimed);
      return r.account;
    } catch {
      return internal("/me");
    }
  });
  const grants = useAsync(() => internal<{ data: any[] }>("/credits/grants"), [claimed]);
  const buy = useAction(async (productId: string) => {
    const { url } = await internal<{ url: string }>("/credits/checkout", { method: "POST", body: { product_id: productId } });
    window.location.assign(url);
  });
  useEffect(() => {
    if (params.get("purchased")) {
      const t = setTimeout(() => {
        void account.reload();
        setParams({}, { replace: true });
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [params]);

  const a = account.data;
  return (
    <>
      <h1>Credits</h1>
      <p className="muted">Credits are prepaid and used for inference at each provider's per-token price. They don't expire.</p>
      {params.get("purchased") && <div className="notice">Thanks! Your purchase is being processed. Your balance will update in a moment.</div>}
      {claimed != null && <div className="notice">{usd(claimed)} in credits were added to your balance.</div>}
      <ErrorText error={account.error} />
      {account.loading && !a ? (
        <Spinner />
      ) : (
        a && (
          <div className="grid cols-3" style={{ marginTop: 16 }}>
            <div className="card stat">
              <div className="label">Balance</div>
              <div className="value">{usd(a.balance)}</div>
            </div>
            <div className="card stat">
              <div className="label">Total purchased</div>
              <div className="value">{usd(a.total_credits)}</div>
            </div>
            <div className="card stat">
              <div className="label">Total spent</div>
              <div className="value">{usd(a.total_usage)}</div>
            </div>
          </div>
        )
      )}

      <h2>Add credits</h2>
      <div className="grid cols-4">
        {PACKS.map((p) => (
          <div className="card pad" key={p.id}>
            <div style={{ fontSize: 24, fontWeight: 650 }}>{usd(p.amount, 0)}</div>
            <div className="faint small" style={{ marginBottom: 12 }}>
              {usd(p.price)} incl. 5.5% fee
            </div>
            <button type="button" className="btn primary" style={{ width: "100%" }} disabled={buy.pending} onClick={() => buy.run(p.id)}>
              Buy
            </button>
          </div>
        ))}
      </div>
      <ErrorText error={buy.error} />
      <p className="faint small">Payments are processed securely by Hexclave and Stripe. You'll be redirected to checkout.</p>

      <h2>History</h2>
      <div className="card table-wrap">
        {grants.loading && !grants.data ? (
          <Spinner />
        ) : grants.data?.data.length ? (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {grants.data.data.map((g) => (
                <tr key={g.id}>
                  <td>{new Date(g.created_at).toLocaleString()}</td>
                  <td>{g.note ?? g.source}</td>
                  <td className="num">{usd(g.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No credit purchases yet.</div>
        )}
      </div>
    </>
  );
}
