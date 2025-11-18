import { shopifyApp } from "@shopify/shopify-app-express";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-10";
import { createSessionStorage } from "./session-storage.js";
import { BillingInterval, ApiVersion } from "@shopify/shopify-api";

// The transactions with Shopify will always be marked as test transactions, unless NODE_ENV is production.
// See the ensureBilling helper to learn more about billing in this template.
const billingConfig = {
  "My Shopify One-Time Charge": {
    // This is an example configuration that would do a one-time charge for $5 (only USD is currently supported)
    amount: 5.0,
    currencyCode: "USD",
    interval: BillingInterval.OneTime,
  },
};

// Validate required environment variables
const requiredEnvVars = {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
  HOST: process.env.HOST,
};

console.log("Environment variables check:");
Object.entries(requiredEnvVars).forEach(([key, value]) => {
  console.log(`${key}: ${value ? "✓ Set" : "✗ Missing"}`);
});

const hostName = process.env.HOST?.replace(/https?:\/\//, "");

if (!hostName) {
  throw new Error(
    "Missing required environment variable: HOST. Please set it to your Vercel deployment URL (e.g., your-app.vercel.app)"
  );
}

console.log("[Shopify] Initializing with hostName:", hostName);
console.log("[Shopify] API Key:", process.env.SHOPIFY_API_KEY?.substring(0, 8) + "...");

const shopify = shopifyApp({
  api: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: process.env.SCOPES?.split(",") || ["write_products"],
    hostName,
    apiVersion: ApiVersion.October25,
    restResources,
    future: {
      customerAddressDefaultFix: true,
      lineItemBilling: true,
      unstable_managedPricingSupport: true,
    },
    billing: undefined, // or replace with billingConfig above to enable example billing
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  // Automatically uses SQLite in dev, cloud storage in production
  sessionStorage: await createSessionStorage(),
});

export default shopify;
