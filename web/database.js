import pg from "pg";

const { Pool } = pg;

// PostgreSQL Database Class
class PostgreSQLDatabase {
  constructor(connectionString) {
    if (!connectionString) {
      throw new Error(
        "[Database] DATABASE_URL environment variable is required. " +
        "Please set it to your PostgreSQL connection string (e.g., from Supabase)."
      );
    }

    // Determine if SSL is needed (for cloud databases)
    const isProduction = process.env.NODE_ENV === "production";
    const isLocalhost = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

    const poolConfig = {
      connectionString,
      // Optimal settings for serverless
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

    // Add SSL config for non-localhost connections in production
    if (isProduction && !isLocalhost) {
      poolConfig.ssl = {
        rejectUnauthorized: false,
      };
    }

    console.log("[Database] Initializing with SSL:", !!poolConfig.ssl);
    this.pool = new Pool(poolConfig);
  }

  async initialize() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id SERIAL PRIMARY KEY,
        shop TEXT NOT NULL,
        vendor_name TEXT NOT NULL,
        product_count INTEGER DEFAULT 0,
        has_config BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shop, vendor_name)
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS vendor_configs (
        id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL,
        metafield_configs TEXT NOT NULL,
        file_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE CASCADE,
        UNIQUE(vendor_id)
      )
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_vendors_shop ON vendors(shop)
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_vendors_shop_name ON vendors(shop, vendor_name)
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS vendor_files (
        id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL,
        shop TEXT NOT NULL,
        shopify_file_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT,
        file_url TEXT,
        file_size INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE CASCADE
      )
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_vendor_files_vendor ON vendor_files(vendor_id)
    `);

    console.log("[Database] PostgreSQL initialized successfully");
  }

  async query(sql, params = []) {
    // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await this.pool.query(pgSql, params);
    return result;
  }

  async close() {
    await this.pool.end();
  }
}

// Database Wrapper with Application Logic
class Database {
  constructor() {
    console.log("[Database] Using PostgreSQL");
    this.db = new PostgreSQLDatabase(process.env.DATABASE_URL);
  }

  async initialize() {
    return await this.db.initialize();
  }

  async query(sql, params = []) {
    return await this.db.query(sql, params);
  }

  // Vendor operations
  async getOrCreateVendor(shop, vendorName) {
    const result = await this.query(
      "SELECT * FROM vendors WHERE shop = ? AND vendor_name = ?",
      [shop, vendorName]
    );
    let vendor = result.rows[0];

    if (!vendor) {
      const insertResult = await this.query(
        "INSERT INTO vendors (shop, vendor_name, product_count, has_config) VALUES (?, ?, 0, FALSE) RETURNING *",
        [shop, vendorName]
      );
      vendor = insertResult.rows[0];
    }

    return vendor;
  }

  async getAllVendors(shop) {
    const result = await this.query(
      `SELECT v.*, vc.metafield_configs, vc.file_id
       FROM vendors v
       LEFT JOIN vendor_configs vc ON v.id = vc.vendor_id
       WHERE v.shop = ?
       ORDER BY v.vendor_name`,
      [shop]
    );
    return result.rows;
  }

  async getVendorByName(shop, vendorName) {
    const result = await this.query(
      `SELECT v.*, vc.metafield_configs, vc.file_id
       FROM vendors v
       LEFT JOIN vendor_configs vc ON v.id = vc.vendor_id
       WHERE v.shop = ? AND v.vendor_name = ?`,
      [shop, vendorName]
    );
    return result.rows[0];
  }

  async updateVendorProductCount(shop, vendorName, count) {
    await this.query(
      "UPDATE vendors SET product_count = ?, updated_at = CURRENT_TIMESTAMP WHERE shop = ? AND vendor_name = ?",
      [count, shop, vendorName]
    );
  }

  // Vendor config operations
  async saveVendorConfig(vendorId, metafieldConfigs, fileId = null) {
    const result = await this.query(
      "SELECT * FROM vendor_configs WHERE vendor_id = ?",
      [vendorId]
    );
    const existing = result.rows[0];

    if (existing) {
      await this.query(
        `UPDATE vendor_configs
         SET metafield_configs = ?, file_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE vendor_id = ?`,
        [JSON.stringify(metafieldConfigs), fileId, vendorId]
      );
    } else {
      await this.query(
        `INSERT INTO vendor_configs (vendor_id, metafield_configs, file_id)
         VALUES (?, ?, ?)`,
        [vendorId, JSON.stringify(metafieldConfigs), fileId]
      );
    }

    // Update vendor has_config flag
    await this.query(
      "UPDATE vendors SET has_config = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [vendorId]
    );
  }

  async getVendorConfig(vendorId) {
    const result = await this.query(
      "SELECT * FROM vendor_configs WHERE vendor_id = ?",
      [vendorId]
    );
    const config = result.rows[0];

    if (config && config.metafield_configs) {
      // Handle both string and already-parsed JSON
      if (typeof config.metafield_configs === 'string') {
        config.metafield_configs = JSON.parse(config.metafield_configs);
      }
    }

    return config;
  }

  async deleteVendorConfig(vendorId) {
    await this.query("DELETE FROM vendor_configs WHERE vendor_id = ?", [
      vendorId,
    ]);

    // Update vendor has_config flag
    await this.query(
      "UPDATE vendors SET has_config = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [vendorId]
    );
  }

  // Vendor file operations
  async saveVendorFile(vendorId, shop, fileData) {
    const result = await this.query(
      `INSERT INTO vendor_files (vendor_id, shop, shopify_file_id, filename, file_type, file_url, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        vendorId,
        shop,
        fileData.shopifyFileId,
        fileData.filename,
        fileData.fileType,
        fileData.fileUrl,
        fileData.fileSize,
      ]
    );
    return result.rows[0];
  }

  async getVendorFiles(vendorId) {
    const result = await this.query(
      "SELECT * FROM vendor_files WHERE vendor_id = ? ORDER BY created_at DESC",
      [vendorId]
    );
    return result.rows;
  }

  async getFileById(fileId) {
    const result = await this.query(
      "SELECT * FROM vendor_files WHERE id = ?",
      [fileId]
    );
    return result.rows[0];
  }

  async getFileByGid(shop, shopifyFileId) {
    const result = await this.query(
      "SELECT * FROM vendor_files WHERE shop = ? AND shopify_file_id = ?",
      [shop, shopifyFileId]
    );
    return result.rows[0];
  }

  async deleteVendorFile(fileId) {
    await this.query("DELETE FROM vendor_files WHERE id = ?", [fileId]);
  }

  close() {
    this.db.close();
  }
}

const database = new Database();

export default database;