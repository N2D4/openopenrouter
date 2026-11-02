import { useState } from "react";
import { Link, useParams } from "react-router";
import { fmtInt, loadModels, money, publicApi } from "../api";
import { CodeTabs } from "../CodeTabs";
import { AuthorTile } from "../icons";
import { CopyButton, ErrorText, Spinner, useAsync } from "../lib";
import { snippets } from "../snippets";
import { compactTokens, priceLabel } from "./Models";

export function ModelDetail() {
  const { author, slug } = useParams();
  const id = `${author}/${slug}`;
  const { data, error, loading } = useAsync(() => publicApi<{ data: any }>(`/models/${id}/endpoints`), [id]);
  const models = useAsync(loadModels);
  const [more, setMore] = useState(false);
  const model = models.data?.find((m) => m.id === id);
  if (loading || models.loading) return <Spinner />;
  if (error || !data || !model) {
    return (
      <main className="page narrow">
        <h1>Model not found</h1>
        <ErrorText error={error} />
        <Link to="/models">Browse all models</Link>
      </main>
    );
  }
  const ep = data.data.endpoints[0];
  const p = model.pricing;
  const inMods: string[] = model.architecture.input_modalities ?? [];
  const outMods: string[] = model.architecture.output_modalities ?? [];
  return (
    <main className="page model-page">
      <div className="model-hero">
        <div className="model-hero-title">
          <AuthorTile author={author!} size={30} />
          <h1>{model.name}</h1>
        </div>
        <a className="btn" href="#api">
          API
        </a>
      </div>
      <div className="model-id">
        <Link to={`/models?author=${author}`}>{author}</Link>/{slug}
        <CopyButton text={model.id} />
      </div>
      <p className={`model-lead ${more ? "" : "clamp"}`}>{model.description}</p>
      {model.description?.length > 220 && (
        <button type="button" className="link-btn" onClick={() => setMore((m) => !m)}>
          {more ? "Show less" : "Show more"}
        </button>
      )}

      <div className="fact-tiles">
        <div>
          <span>Modalities</span>
          <strong>
            {inMods.join(", ")} → {outMods.join(", ")}
          </strong>
        </div>
        <div>
          <span>In / Out price</span>
          <strong>
            {money(p.prompt)} / {money(p.completion)} <small>per 1M</small>
          </strong>
        </div>
        <div>
          <span>Context</span>
          <strong>{compactTokens(model.context_length)}</strong>
        </div>
        <div>
          <span>Released</span>
          <strong>{new Date(model.created * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong>
        </div>
      </div>

      <section className="model-section">
        <h2>Provider</h2>
        <p className="muted">Requests go straight to the model's own provider. Prices are per million tokens.</p>
        <div className="table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className="num">Context</th>
                  <th className="num">Max output</th>
                  <th className="num">Input</th>
                  <th className="num">Output</th>
                  {p.input_cache_read && <th className="num">Cache read</th>}
                  {p.input_cache_write && <th className="num">Cache write</th>}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="row" style={{ gap: 10 }}>
                      <AuthorTile author={author!} size={22} />
                      {ep.provider_name}
                    </span>
                  </td>
                  <td className="num">{compactTokens(model.context_length)}</td>
                  <td className="num">{model.top_provider.max_completion_tokens ? compactTokens(model.top_provider.max_completion_tokens) : "–"}</td>
                  <td className="num">{money(p.prompt)}</td>
                  <td className="num">{money(p.completion)}</td>
                  {p.input_cache_read && <td className="num">{money(p.input_cache_read)}</td>}
                  {p.input_cache_write && <td className="num">{money(p.input_cache_write)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        {p.overrides?.map((o: any) => (
          <p key={o.min_prompt_tokens} className="faint small">
            Prompts over {fmtInt(o.min_prompt_tokens)} tokens: {priceLabel(o.prompt)} input, {priceLabel(o.completion)} output.
          </p>
        ))}
      </section>

      <section className="model-section">
        <h2>Capabilities</h2>
        <div className="pill-list">
          {model.supported_parameters.map((s: string) => (
            <span key={s} className="pill">
              {s}
            </span>
          ))}
        </div>
        {model.reasoning?.supported_efforts && (
          <p className="muted small">
            Reasoning efforts: {model.reasoning.supported_efforts.join(", ")}
            {model.reasoning.default_effort && ` (default ${model.reasoning.default_effort})`}
          </p>
        )}
      </section>

      <section className="model-section" id="api">
        <h2>API</h2>
        <p className="muted">
          Use <code>{model.id}</code> as the model with any OpenAI- or OpenRouter-compatible client. See the <Link to="/docs">docs</Link> for streaming, tools
          and fallbacks.
        </p>
        <CodeTabs tabs={snippets(model.id)} />
      </section>
    </main>
  );
}
