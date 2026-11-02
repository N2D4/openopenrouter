import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { loadModels, perMillion } from "../api";
import { AuthorTile, SearchIcon } from "../icons";
import { ErrorText, Spinner, useAsync } from "../lib";

export function priceLabel(p: string | undefined) {
  const v = perMillion(p);
  if (v == null) return "–";
  return v === 0 ? "Free" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 3 })}/M`;
}

export function compactTokens(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}K`;
  return String(n);
}

const fmtDate = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const AUTHORS = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
] as const;

const FEATURES = [
  ["tools", "Tool calling"],
  ["reasoning", "Reasoning"],
  ["structured_outputs", "Structured outputs"],
  ["image", "Image input"],
  ["file", "File input"],
] as const;

function has(m: any, f: string) {
  if (f === "image" || f === "file") return m.architecture?.input_modalities?.includes(f);
  return m.supported_parameters?.includes(f);
}

export function Models() {
  const { data, error, loading } = useAsync(loadModels);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "newest";
  const author = params.get("author") ?? "all";
  const features = params.getAll("feature");

  const update = (fn: (p: URLSearchParams) => void) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        fn(p);
        return p;
      },
      { replace: true },
    );
  const set = (k: string, v: string, empty: string) => update((p) => (v === empty ? p.delete(k) : p.set(k, v)));
  const toggleFeature = (f: string) =>
    update((p) => {
      const cur = p.getAll("feature");
      p.delete("feature");
      for (const x of cur.includes(f) ? cur.filter((c) => c !== f) : [...cur, f]) p.append("feature", x);
    });

  const all = data ?? [];
  const models = useMemo(() => {
    let list = all;
    if (author !== "all") list = list.filter((m) => m.id.startsWith(`${author}/`));
    for (const f of features) list = list.filter((m) => has(m, f));
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((m) => m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s));
    }
    const sorted = [...list];
    if (sort === "price") sorted.sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt));
    else if (sort === "price-desc") sorted.sort((a, b) => Number(b.pricing.prompt) - Number(a.pricing.prompt));
    else if (sort === "context") sorted.sort((a, b) => b.context_length - a.context_length);
    else sorted.sort((a, b) => b.created - a.created);
    return sorted;
  }, [all, q, author, sort, features.join()]);

  const count = (a: string) => (a === "all" ? all.length : all.filter((m) => m.id.startsWith(`${a}/`)).length);

  return (
    <main className="models-page">
      <aside className="filters" aria-label="Filters">
        <div className="filter-group">
          <h3>Providers</h3>
          {AUTHORS.map(([id, label]) => (
            <label key={id} className="check">
              <input type="checkbox" checked={author === id} onChange={() => set("author", author === id ? "all" : id, "all")} />
              {label}
              <span className="faint">{count(id)}</span>
            </label>
          ))}
        </div>
        <div className="filter-group">
          <h3>Features</h3>
          {FEATURES.map(([id, label]) => (
            <label key={id} className="check">
              <input type="checkbox" checked={features.includes(id)} onChange={() => toggleFeature(id)} />
              {label}
            </label>
          ))}
        </div>
      </aside>
      <section className="models-main">
        <div className="models-title">
          <h1>Models</h1>
          {data && <span className="faint small">{models.length} models</span>}
        </div>
        <div className="models-toolbar">
          <div className="input-icon">
            <SearchIcon />
            <input placeholder="Search models..." value={q} onChange={(e) => set("q", e.target.value, "")} aria-label="Search models" />
          </div>
          <select value={sort} onChange={(e) => set("sort", e.target.value, "newest")} aria-label="Sort">
            <option value="newest">Newest</option>
            <option value="price">Pricing: low to high</option>
            <option value="price-desc">Pricing: high to low</option>
            <option value="context">Context: high to low</option>
          </select>
        </div>
        <div className="tabbar" role="tablist">
          {[["all", "All"], ...AUTHORS].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={author === id} className={author === id ? "active" : ""} onClick={() => set("author", id, "all")}>
              {label} <span>{count(id)}</span>
            </button>
          ))}
        </div>
        {loading && <Spinner />}
        <ErrorText error={error} />
        <div className="model-list">
          {models.map((m) => {
            const a = m.id.split("/")[0];
            return (
              <article className="model-item" key={m.id}>
                <div className="model-item-head">
                  <AuthorTile author={a} size={24} />
                  <h2>
                    <Link to={`/models/${m.id}`}>{m.name}</Link>
                  </h2>
                  <span className="spacer" />
                  <span className="faint small">{compactTokens(m.context_length)} context</span>
                </div>
                <p className="model-desc">{m.description}</p>
                <div className="model-facts">
                  <span>
                    by <Link to={`/models?author=${a}`}>{a}</Link>
                  </span>
                  <span>{fmtDate(m.created)}</span>
                  <span>{priceLabel(m.pricing.prompt)} input tokens</span>
                  <span>{priceLabel(m.pricing.completion)} output tokens</span>
                  {m.supported_parameters?.includes("reasoning") && <span className="pill">reasoning</span>}
                  {m.architecture?.input_modalities?.includes("image") && <span className="pill">vision</span>}
                </div>
              </article>
            );
          })}
          {data && !models.length && <div className="empty">No models match these filters.</div>}
        </div>
      </section>
    </main>
  );
}
