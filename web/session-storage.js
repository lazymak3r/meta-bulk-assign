import { PostgreSQLSessionStorage } from "@shopify/shopify-app-session-storage-postgresql";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

  // Retry session storage creation on cold starts (Vercel serverless)
  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const storage = new PostgreSQLSessionStorage(process.env.DATABASE_URL, options);
      // Force the connection to initialize by calling ready()
      if (typeof storage.ready === 'function') {
        await storage.ready();
      }
      console.log(`[Session Storage] Connected successfully (attempt ${attempt})`);
      return storage;
    } catch (error) {
      lastError = error;
      console.warn(`[Session Storage] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt);
      }
    }
  }

  // Last resort: return the storage anyway — it may recover on its own
  console.error(`[Session Storage] All ${MAX_RETRIES} attempts failed, creating storage anyway:`, lastError.message);
  return new PostgreSQLSessionStorage(process.env.DATABASE_URL, options);
}
