import { defineHexclaveConfig } from "@hexclave/react";

/**
 * Hexclave project configuration for OpenOpenRouter.
 * Push to the cloud project with `pnpm hexclave:push --cloud-project-id <id>`.
 *
 * Environment-specific settings (trusted domains, payments test mode, Stripe connection,
 * production OAuth credentials, email server) live in the Hexclave dashboard instead.
 */
export const config = defineHexclaveConfig({
  apps: {
    installed: {
      authentication: { enabled: true },
      emails: { enabled: true },
      payments: { enabled: true },
      analytics: { enabled: true },
    },
  },

  auth: { allowSignUp: true },
  "auth.otp": { allowSignIn: true },
  "auth.password": { allowSignIn: false },
  "auth.passkey": { allowSignIn: true },
  "auth.oauth": {
    accountMergeStrategy: "link_method",
    providers: {
      github: { type: "github", allowSignIn: true, allowConnectedAccounts: false },
      google: { type: "google", allowSignIn: true, allowConnectedAccounts: false },
    },
  },

  // Prepaid credit packs. Each pack grants the `credits` item in US cents; the gateway moves
  // purchased cents into its own usage ledger (see src/worker/routes/dashboard.ts). Prices
  // include a 5.5% platform fee on top of the credited amount, like OpenRouter.
  payments: {
    items: {
      credits: { displayName: "Credits (US cents)", customerType: "user" },
    },
    products: {
      credits_5usd: {
        displayName: "$5 in credits",
        customerType: "user",
        stackable: true,
        prices: { once: { USD: "5.28" } },
        includedItems: { credits: { quantity: 500, repeat: "never", expires: "never" } },
      },
      credits_10usd: {
        displayName: "$10 in credits",
        customerType: "user",
        stackable: true,
        prices: { once: { USD: "10.55" } },
        includedItems: { credits: { quantity: 1000, repeat: "never", expires: "never" } },
      },
      credits_25usd: {
        displayName: "$25 in credits",
        customerType: "user",
        stackable: true,
        prices: { once: { USD: "26.38" } },
        includedItems: { credits: { quantity: 2500, repeat: "never", expires: "never" } },
      },
      credits_100usd: {
        displayName: "$100 in credits",
        customerType: "user",
        stackable: true,
        prices: { once: { USD: "105.50" } },
        includedItems: { credits: { quantity: 10000, repeat: "never", expires: "never" } },
      },
    },
  },
});
