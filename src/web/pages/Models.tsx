import { useMemo, useState } from "react";
import { Link } from "react-router";
import { fmtInt, perMillion, publicApi } from "../api";
import { ErrorText, Spinner, useAsync } from "../lib";

export function priceLabel(p: string | undefined) {
  const v = perMillion(p);
  if (v == null) return "–";
  return v === 0 ? "Free" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 3 })}/M`;
}

export function Models() {
  const { data, error, loading } = useAsync(() => publicApi<{ data: any[] }>("/models"));
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("all");
  const [sort, setSort] = useState("newest");
  const models = useMemo(() => {
    let list = data?.data ?? [];
    if (provider !== "all") list = list.filter((m) => m.id.startsWith(`${provider}/`));
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((m) => m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s));
    }
    const sorted = [...list];
    if (sort === "price") sorted.sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt));
    else if (sort === "context") sorted.sort((a, b) => b.context_length - a.context_length);
    else sorted.sort((a, b) => b.created - a.created);
    return sorted;
  }, [data, q, provider, sort]);

  return (
    <main className="page">
      <h1>Models</h1>
      <p className="muted">Every model is served directly by its provider. Prices are per million tokens.</p>
      <div className="row wrap" style={{ margin: "18px 0 6px" }}>
        <input style={{ maxWidth: 340 }} placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" />
        <select style={{ width: 160 }} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
          <option value="all">All providers</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
        </select>
        <select style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="newest">Newest</option>
          <option value="price">Lowest input price</option>
          <option value="context">Largest context</option>
        </select>
        <span className="spacer" />
        {data && <span className="faint small">{models.length} models</span>}
      </div>
      {loading && <Spinner />}
      <ErrorText error={error} />
      <div>
        {models.map((m) => (
          <div className="model-row" key={m.id}>
            <div>
              <h3>
                <Link to={`/models/${m.id}`}>{m.name}</Link>
              </h3>
              <div className="model-meta">
                <span className="mono">{m.id}</span>
                <span>{fmtInt(m.context_length)} context</span>
                {m.architecture?.input_modalities?.includes("image") && <span>vision</span>}
                {m.supported_parameters?.includes("tools") && <span>tools</span>}
                {m.supported_parameters?.includes("reasoning") && <span>reasoning</span>}
              </div>
            </div>
            <div className="model-price">
              <div>{priceLabel(m.pricing.prompt)} input</div>
              <div>{priceLabel(m.pricing.completion)} output</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
