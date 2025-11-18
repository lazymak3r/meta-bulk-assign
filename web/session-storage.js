import { PostgreSQLSessionStorage } from "@shopify/shopify-app-session-storage-postgresql";

export async function createSessionStorage() {
  // Ensure DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[Session Storage] DATABASE_URL environment variable is required. " +
      "Please set it to your PostgreSQL connection string (e.g., from Supabase)."
    );
  }

  const isProduction = process.env.NODE_ENV === "production";
  const isLocalhost = process.env.DATABASE_URL.includes("localhost") ||
                      process.env.DATABASE_URL.includes("127.0.0.1");

  const options = {};

  // Add SSL config for non-localhost connections in production
  if (isProduction && !isLocalhost) {
    options.ssl = {
      rejectUnauthorized: false,
    };
  }

  console.log("[Session Storage] Using PostgreSQL with SSL:", !!options.ssl);
  return new PostgreSQLSessionStorage(process.env.DATABASE_URL, options);
}