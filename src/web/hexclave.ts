import { HexclaveClientApp } from "@hexclave/react";

export const hexclaveClientApp = new HexclaveClientApp({
  projectId: __HEXCLAVE_PROJECT_ID__,
  baseUrl: __HEXCLAVE_API_URL__,
  tokenStore: "cookie",
  urls: {
    default: { type: "hosted" },
    afterSignIn: "/settings/keys",
    afterSignUp: "/settings/keys",
    afterSignOut: "/",
    home: "/",
  },
});
