import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Single source of truth: public Hexclave settings come from wrangler.jsonc `vars`.
const wrangler = JSON.parse(
  readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1"),
);
const vars = wrangler.vars as Record<string, string>;

/**
 * Hexclave's theme provider runs its colour-mode detection script through `eval` (meant for SSR).
 * In this client-only SPA we call the function directly, so the CSP can forbid 'unsafe-eval'.
 */
function hexclaveNoEval(): Plugin {
  const target = /@hexclave\/react\/dist\/esm\/utils\/browser-script\.js$/;
  const original = /function BrowserScript\(props\) \{[\s\S]*?\n\}/;
  return {
    name: "hexclave-no-eval",
    enforce: "pre",
    transform(code, id) {
      if (!target.test(id.split("?")[0])) return null;
      if (!original.test(code)) throw new Error("hexclave-no-eval: BrowserScript changed upstream; update vite.config.ts");
      return (
        `import { useLayoutEffect as __useLayoutEffect } from "react";\n` +
        code.replace(original, "function BrowserScript() {\n\t__useLayoutEffect(() => { script(); }, []);\n\treturn null;\n}")
      );
    },
  };
}

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  plugins: [hexclaveNoEval(), react()],
  define: {
    __HEXCLAVE_PROJECT_ID__: JSON.stringify(vars.HEXCLAVE_PROJECT_ID),
    __HEXCLAVE_API_URL__: JSON.stringify(vars.HEXCLAVE_API_URL),
    __SITE_NAME__: JSON.stringify(vars.SITE_NAME),
    __PUBLIC_URL__: JSON.stringify(vars.PUBLIC_URL),
  },
  build: { outDir: "../../dist/client", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 2000 },
  server: { proxy: { "/api/": "http://localhost:8787" } },
});
