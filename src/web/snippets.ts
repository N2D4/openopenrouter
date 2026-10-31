const BASE = `${__PUBLIC_URL__}/api/v1`;

export function snippets(model: string) {
  return {
    curl: `curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer $OPENOPENROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{ "role": "user", "content": "What is the meaning of life?" }]
  }'`,
    typescript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: process.env.OPENOPENROUTER_API_KEY,
});

const completion = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "What is the meaning of life?" }],
});
console.log(completion.choices[0].message.content);`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key=os.environ["OPENOPENROUTER_API_KEY"],
)

completion = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "What is the meaning of life?"}],
)
print(completion.choices[0].message.content)`,
  };
}

export const CLAUDE_CODE = `export ANTHROPIC_BASE_URL="${__PUBLIC_URL__}/api"
export ANTHROPIC_AUTH_TOKEN="$OPENOPENROUTER_API_KEY"
export ANTHROPIC_API_KEY=""
claude`;
