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

    const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

    const poolConfig = {
      connectionString,
      max: isServerless ? 3 : 20,
      idleTimeoutMillis: isServerless ? 10000 : 30000,
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
    // Schema is managed by Prisma migrations — no CREATE TABLE needed here.
    // Just verify the connection works.
    await this.query('SELECT 1');
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

  // Configuration operations
  async createConfiguration(shop, name, type, metafieldConfigs, priority = 0) {
    const result = await this.query(
      `INSERT INTO configurations (shop, name, type, metafield_configs, priority)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
      [shop, name, type, JSON.stringify(metafieldConfigs), priority]
    );
    return result.rows[0];
  }

  async getAllConfigurations(shop) {
    const result = await this.query(
      `SELECT * FROM configurations
       WHERE shop = ?
       ORDER BY priority DESC, created_at DESC`,
      [shop]
    );

    // Parse metafield_configs JSON
    return result.rows.map(config => ({
      ...config,
      metafield_configs: typeof config.metafield_configs === 'string'
        ? JSON.parse(config.metafield_configs)
        : config.metafield_configs
    }));
  }

  async getConfigurationById(id) {
    const result = await this.query(
      "SELECT * FROM configurations WHERE id = ?",
      [id]
    );
    const config = result.rows[0];

    if (config && config.metafield_configs) {
      if (typeof config.metafield_configs === 'string') {
        config.metafield_configs = JSON.parse(config.metafield_configs);
      }
    }

    return config;
  }

  async updateConfiguration(id, name, type, metafieldConfigs) {
    await this.query(
      `UPDATE configurations
       SET name = ?, type = ?, metafield_configs = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, type, JSON.stringify(metafieldConfigs), id]
    );
  }

  async deleteConfiguration(id) {
    await this.query("DELETE FROM configurations WHERE id = ?", [id]);
  }

  async duplicateConfiguration(id, shop) {
    // Get original configuration
    const original = await this.getConfigurationById(id);
    if (!original) return null;

    // Create new configuration with "Copy" suffix
    const newName = original.name ? `${original.name} (Copy)` : null;
    const newConfig = await this.createConfiguration(
      shop,
      newName,
      original.type,
      original.metafield_configs,
      original.priority
    );

    // Get original rules
    const rules = await this.getConfigurationRules(id);

    // Duplicate rules with new configuration_id
    for (const rule of rules) {
      await this.createConfigurationRule(
        newConfig.id,
        rule.parent_id, // Note: This will need mapping if parent_id references are used
        rule.rule_type,
        rule.rule_value,
        rule.rule_id,
        rule.operator,
        rule.level,
        rule.position
      );
    }

    return newConfig;
  }

  async updateConfigurationPriority(id, priority) {
    console.log('[Database] Updating priority:', { id, priority, idType: typeof id, priorityType: typeof priority });
    await this.query(
      "UPDATE configurations SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [priority, id]
    );
  }

  async updateAllPriorities(priorities) {
    // priorities is an array of { id, priority }
    for (const { id, priority } of priorities) {
      await this.updateConfigurationPriority(id, priority);
    }
  }

  // Configuration rules operations
  async createConfigurationRule(configId, parentId, ruleType, ruleValue, ruleId, operator, level, position) {
    const result = await this.query(
      `INSERT INTO configuration_rules (configuration_id, parent_id, rule_type, rule_value, rule_id, operator, level, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [configId, parentId, ruleType, ruleValue, ruleId, operator, level, position]
    );
    return result.rows[0];
  }

  async getConfigurationRules(configId) {
    const result = await this.query(
      `SELECT * FROM configuration_rules
       WHERE configuration_id = ?
       ORDER BY level, position`,
      [configId]
    );
    return result.rows;
  }

  async deleteConfigurationRules(configId) {
    await this.query(
      "DELETE FROM configuration_rules WHERE configuration_id = ?",
      [configId]
    );
  }

  async deleteConfigurationRule(ruleId) {
    await this.query("DELETE FROM configuration_rules WHERE id = ?", [ruleId]);
  }

  /**
   * Delete all data for a shop (GDPR compliance - SHOP_REDACT)
   * Called when a shop uninstalls the app
   */
  async deleteShopData(shop) {
    console.log(`[Database] Deleting all data for shop: ${shop}`);

    // Get all configuration IDs for this shop first
    const configs = await this.query(
      "SELECT id FROM configurations WHERE shop = ?",
      [shop]
    );

    // Delete rules for each configuration (cascade should handle this, but being explicit)
    for (const config of configs.rows) {
      await this.query(
        "DELETE FROM configuration_rules WHERE configuration_id = ?",
        [config.id]
      );
    }

    // Delete all configurations for this shop
    const result = await this.query(
      "DELETE FROM configurations WHERE shop = ?",
      [shop]
    );

    // Delete sync data
    await this.deleteSyncData(shop);

    console.log(`[Database] Deleted ${result.rowCount || 0} configurations for shop: ${shop}`);
    return result.rowCount || 0;
  }

  async bulkCreateRules(configId, rules) {
    // Map old IDs to new database IDs
    const idMap = {};
    const createdRules = [];

    // Sort rules by level to ensure parents are created before children
    const sortedRules = [...rules].sort((a, b) => {
      const levelA = a.level || 0;
      const levelB = b.level || 0;
      return levelA - levelB;
    });

    for (const rule of sortedRules) {
      // Map the parentId if it exists in the idMap
      const mappedParentId = rule.parentId && idMap[rule.parentId]
        ? idMap[rule.parentId]
        : null;

      const created = await this.createConfigurationRule(
        configId,
        mappedParentId,
        rule.ruleType || rule.rule_type,
        rule.ruleValue || rule.rule_value,
        rule.ruleId || rule.rule_id || null,
        rule.operator,
        rule.level,
        rule.position
      );

      // Store mapping of old ID to new database ID
      if (rule.id) {
        idMap[rule.id] = created.id;
      }

      createdRules.push(created);
    }
    return createdRules;
  }

  // Sync Mapping operations
  async createSyncMapping(shop, { source_namespace, source_key, target_display_type, target_namespace, target_key, target_metafield_type = 'list.file_reference' }) {
    const result = await this.query(
      `INSERT INTO sync_mappings (shop, source_namespace, source_key, target_display_type, target_namespace, target_key, target_metafield_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [shop, source_namespace, source_key, target_display_type, target_namespace, target_key, target_metafield_type]
    );
    return result.rows[0];
  }

  async getSyncMappings(shop) {
    const result = await this.query(
      "SELECT * FROM sync_mappings WHERE shop = ? ORDER BY created_at DESC",
      [shop]
    );
    return result.rows;
  }

  async getSyncMappingById(id) {
    const result = await this.query(
      "SELECT * FROM sync_mappings WHERE id = ?",
      [id]
    );
    return result.rows[0];
  }

  async updateSyncMapping(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    await this.query(
      `UPDATE sync_mappings SET ${fields.join(", ")} WHERE id = ?`,
      values
    );
  }

  async deleteSyncMapping(id) {
    await this.query("DELETE FROM sync_mappings WHERE id = ?", [id]);
  }

  // Sync Job operations
  async createSyncJob(shop, mappingSnapshot) {
    const result = await this.query(
      `INSERT INTO sync_jobs (shop, mapping_snapshot)
       VALUES (?, ?)
       RETURNING *`,
      [shop, JSON.stringify(mappingSnapshot)]
    );
    return result.rows[0];
  }

  async updateSyncJobStatus(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'errors' || key === 'file_product_map') {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    values.push(id);

    await this.query(
      `UPDATE sync_jobs SET ${fields.join(", ")} WHERE id = ?`,
      values
    );
  }

  async getSyncJob(id) {
    const result = await this.query(
      "SELECT * FROM sync_jobs WHERE id = ?",
      [id]
    );
    const job = result.rows[0];
    if (job) {
      job.errors = typeof job.errors === 'string' ? JSON.parse(job.errors) : job.errors;
      job.mapping_snapshot = typeof job.mapping_snapshot === 'string' ? JSON.parse(job.mapping_snapshot) : job.mapping_snapshot;
      job.file_product_map = typeof job.file_product_map === 'string' ? JSON.parse(job.file_product_map) : (job.file_product_map || {});
    }
    return job;
  }

  async getLatestSyncJob(shop) {
    const result = await this.query(
      "SELECT * FROM sync_jobs WHERE shop = ? ORDER BY created_at DESC LIMIT 1",
      [shop]
    );
    const job = result.rows[0];
    if (job) {
      job.errors = typeof job.errors === 'string' ? JSON.parse(job.errors) : job.errors;
      job.mapping_snapshot = typeof job.mapping_snapshot === 'string' ? JSON.parse(job.mapping_snapshot) : job.mapping_snapshot;
      job.file_product_map = typeof job.file_product_map === 'string' ? JSON.parse(job.file_product_map) : (job.file_product_map || {});
    }
    return job;
  }

  async getActiveSyncJob(shop) {
    const result = await this.query(
      "SELECT * FROM sync_jobs WHERE shop = ? AND status = 'running' LIMIT 1",
      [shop]
    );
    return result.rows[0];
  }

  // File Cache operations
  async getCachedFile(shop, externalUrl) {
    const result = await this.query(
      "SELECT * FROM sync_file_cache WHERE shop = ? AND external_url = ?",
      [shop, externalUrl]
    );
    return result.rows[0];
  }

  async cacheFile(shop, externalUrl, shopifyFileGid, filename, mimeType) {
    const result = await this.query(
      `INSERT INTO sync_file_cache (shop, external_url, shopify_file_gid, filename, mime_type)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (shop, external_url) DO UPDATE SET shopify_file_gid = EXCLUDED.shopify_file_gid
       RETURNING *`,
      [shop, externalUrl, shopifyFileGid, filename, mimeType]
    );
    return result.rows[0];
  }

  async getCachedFiles(shop, externalUrls) {
    if (!externalUrls || externalUrls.length === 0) return [];
    const placeholders = externalUrls.map((_, i) => `$${i + 2}`).join(", ");
    const result = await this.db.pool.query(
      `SELECT * FROM sync_file_cache WHERE shop = $1 AND external_url IN (${placeholders})`,
      [shop, ...externalUrls]
    );
    return result.rows;
  }

  // Extend deleteShopData to clean up sync tables
  async deleteSyncData(shop) {
    await this.query("DELETE FROM sync_file_cache WHERE shop = ?", [shop]);
    await this.query("DELETE FROM sync_jobs WHERE shop = ?", [shop]);
    await this.query("DELETE FROM sync_mappings WHERE shop = ?", [shop]);
  }

  close() {
    this.db.close();
  }
}

const database = new Database();

export default database;