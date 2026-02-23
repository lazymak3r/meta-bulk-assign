import pg from "pg";
import { Session } from "@shopify/shopify-api";

/**
 * Custom PostgreSQL session storage that uses raw pg queries.
 * Avoids the @shopify/shopify-app-session-storage-postgresql package
 * which hangs on Vercel cold starts due to its migration system
 * conflicting with Supabase's pgbouncer.
 */
class CustomPostgresSessionStorage {
  constructor(connectionString, options = {}) {
    const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

    this.pool = new pg.Pool({
      connectionString,
      max: isServerless ? 3 : 10,
      idleTimeoutMillis: isServerless ? 10000 : 30000,
      connectionTimeoutMillis: 10000,
      ...options,
    });

    this.ready = this.init();
  }

  async init() {
    const timeout = (ms) =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Init timed out after ${ms}ms`)), ms)
      );

    try {
      // Race init against a 8s timeout to prevent cold-start hangs
      await Promise.race([this._doInit(), timeout(8000)]);
    } catch (err) {
      // Log but don't throw — the table likely already exists.
      // Methods will work if the table is there; if not, they'll
      // throw with a clear SQL error on first use.
      console.warn("[Session Storage] Init warning (non-fatal):", err.message);
    }
  }

  async _doInit() {
    // Try a lightweight check first (works well through pgbouncer)
    try {
      await this.pool.query("SELECT 1 FROM shopify_sessions LIMIT 0");
      console.log("[Session Storage] Table already exists");
      return;
    } catch {
      // Table doesn't exist — create it
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_sessions (
        id VARCHAR(255) NOT NULL PRIMARY KEY,
        shop VARCHAR(255) NOT NULL,
        state VARCHAR(255),
        "isOnline" BOOLEAN NOT NULL DEFAULT false,
        scope VARCHAR(1024),
        expires INTEGER,
        "onlineAccessInfo" VARCHAR(4096),
        "accessToken" VARCHAR(255)
      )
    `);
    console.log("[Session Storage] Table created");
  }

  async storeSession(session) {
    await this.ready;
    await this.pool.query(
      `INSERT INTO shopify_sessions (id, shop, state, "isOnline", scope, expires, "onlineAccessInfo", "accessToken")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         shop = EXCLUDED.shop,
         state = EXCLUDED.state,
         "isOnline" = EXCLUDED."isOnline",
         scope = EXCLUDED.scope,
         expires = EXCLUDED.expires,
         "onlineAccessInfo" = EXCLUDED."onlineAccessInfo",
         "accessToken" = EXCLUDED."accessToken"`,
      [
        session.id,
        session.shop,
        session.state || null,
        session.isOnline || false,
        session.scope || null,
        session.expires ? Math.floor(session.expires.getTime() / 1000) : null,
        session.onlineAccessInfo ? JSON.stringify(session.onlineAccessInfo) : null,
        session.accessToken || null,
      ]
    );
    return true;
  }

  async loadSession(id) {
    await this.ready;
    const result = await this.pool.query(
      "SELECT * FROM shopify_sessions WHERE id = $1",
      [id]
    );
    const row = result.rows[0];
    if (!row) return undefined;

    return this._rowToSession(row);
  }

  async deleteSession(id) {
    await this.ready;
    await this.pool.query("DELETE FROM shopify_sessions WHERE id = $1", [id]);
    return true;
  }

  async deleteSessions(ids) {
    await this.ready;
    if (!ids || ids.length === 0) return true;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    await this.pool.query(
      `DELETE FROM shopify_sessions WHERE id IN (${placeholders})`,
      ids
    );
    return true;
  }

  async findSessionsByShop(shop) {
    await this.ready;
    const result = await this.pool.query(
      "SELECT * FROM shopify_sessions WHERE shop = $1",
      [shop]
    );
    return result.rows.map((row) => this._rowToSession(row));
  }

  _rowToSession(row) {
    const session = new Session({
      id: row.id,
      shop: row.shop,
      state: row.state || "",
      isOnline: row.isOnline || false,
    });
    if (row.scope) session.scope = row.scope;
    if (row.expires) session.expires = new Date(row.expires * 1000);
    if (row.onlineAccessInfo) {
      try {
        session.onlineAccessInfo = JSON.parse(row.onlineAccessInfo);
      } catch {
        session.onlineAccessInfo = row.onlineAccessInfo;
      }
    }
    if (row.accessToken) session.accessToken = row.accessToken;
    return session;
  }
}

export async function createSessionStorage() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[Session Storage] DATABASE_URL environment variable is required."
    );
  }

  const isProduction = process.env.NODE_ENV === "production";
  const isLocalhost = process.env.DATABASE_URL.includes("localhost") ||
                      process.env.DATABASE_URL.includes("127.0.0.1");

  const poolOptions = {};
  if (isProduction && !isLocalhost) {
    poolOptions.ssl = { rejectUnauthorized: false };
  }

  console.log("[Session Storage] Using custom PostgreSQL storage, SSL:", !!poolOptions.ssl);

  const storage = new CustomPostgresSessionStorage(process.env.DATABASE_URL, poolOptions);
  // DON'T await storage.ready here — let it initialize lazily on first use.
  // Each method already does `await this.ready` before executing queries.
  // Awaiting here blocks the entire module on cold start, causing Vercel timeouts.
  console.log("[Session Storage] Created (initializing in background)");
  return storage;
}
