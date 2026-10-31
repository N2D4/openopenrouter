import { Fragment } from "react";
import { useParams } from "react-router";
import { fmtInt, publicApi } from "../api";
import { CodeTabs } from "../CodeTabs";
import { CopyButton, ErrorText, Spinner, useAsync } from "../lib";
import { snippets } from "../snippets";
import { priceLabel } from "./Models";

export function ModelDetail() {
  const { author, slug } = useParams();
  const id = `${author}/${slug}`;
  const { data, error, loading } = useAsync(() => publicApi<{ data: any }>(`/models/${id}/endpoints`), [id]);
  const models = useAsync(() => publicApi<{ data: any[] }>("/models"));
  const model = models.data?.data.find((m) => m.id === id);
  if (loading || models.loading) return <Spinner />;
  if (error || !data || !model) {
    return (
      <main className="page narrow">
        <h1>Model not found</h1>
        <ErrorText error={error} />
      </main>
    );
  }
  const ep = data.data.endpoints[0];
  const p = model.pricing;
  return (
    <main className="page narrow">
      <h1>{model.name}</h1>
      <div className="row" style={{ marginBottom: 18 }}>
        <code>{model.id}</code>
        <CopyButton text={model.id} />
      </div>
      <p className="muted">{model.description}</p>
      <dl className="kv card pad">
        <dt>Provider</dt>
        <dd>{ep.provider_name}</dd>
        <dt>Context window</dt>
        <dd>{fmtInt(model.context_length)} tokens</dd>
        <dt>Max output</dt>
        <dd>{model.top_provider.max_completion_tokens ? `${fmtInt(model.top_provider.max_completion_tokens)} tokens` : "–"}</dd>
        <dt>Input price</dt>
        <dd>{priceLabel(p.prompt)}</dd>
        <dt>Output price</dt>
        <dd>{priceLabel(p.completion)}</dd>
        {p.input_cache_read && (
          <>
            <dt>Cache read</dt>
            <dd>{priceLabel(p.input_cache_read)}</dd>
          </>
        )}
        {p.input_cache_write && (
          <>
            <dt>Cache write</dt>
            <dd>{priceLabel(p.input_cache_write)}</dd>
          </>
        )}
        {p.overrides?.map((o: any) => (
          <Fragment key={o.min_prompt_tokens}>
            <dt>Prompts over {fmtInt(o.min_prompt_tokens)} tokens</dt>
            <dd>
              {priceLabel(o.prompt)} input · {priceLabel(o.completion)} output
            </dd>
          </Fragment>
        ))}
        <dt>Input modalities</dt>
        <dd>{model.architecture.input_modalities?.join(", ")}</dd>
        <dt>Supported parameters</dt>
        <dd className="small">{model.supported_parameters.join(", ") || "–"}</dd>
        {model.reasoning?.supported_efforts && (
          <>
            <dt>Reasoning efforts</dt>
            <dd>{model.reasoning.supported_efforts.join(", ")}</dd>
          </>
        )}
      </dl>
      <h2>Quickstart</h2>
      <CodeTabs tabs={snippets(model.id)} />
    </main>
  );
}
