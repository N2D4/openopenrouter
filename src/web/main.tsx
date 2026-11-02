import "@fontsource-variable/plus-jakarta-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { hexclaveClientApp } from "./hexclave";
import "./styles.css";
import { initTheme } from "./theme";

initTheme();
hexclaveClientApp.initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
