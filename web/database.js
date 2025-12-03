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
    // Create configurations table
    await this.query(`
      CREATE TABLE IF NOT EXISTS configurations (
        id SERIAL PRIMARY KEY,
        shop TEXT NOT NULL,
        name TEXT,
        type TEXT NOT NULL CHECK (type IN ('vendor', 'category', 'collection', 'product', 'combined')),
        metafield_configs TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        show_on_storefront BOOLEAN DEFAULT false,
        storefront_position TEXT DEFAULT 'after_price',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add new columns to existing table if they don't exist
    try {
      await this.query(`
        ALTER TABLE configurations
        ADD COLUMN IF NOT EXISTS show_on_storefront BOOLEAN DEFAULT false
      `);
      await this.query(`
        ALTER TABLE configurations
        ADD COLUMN IF NOT EXISTS storefront_position TEXT DEFAULT 'after_price'
      `);
    } catch (err) {
      console.log('[Database] Columns may already exist:', err.message);
    }

    // Create configuration_rules table
    await this.query(`
      CREATE TABLE IF NOT EXISTS configuration_rules (
        id SERIAL PRIMARY KEY,
        configuration_id INTEGER NOT NULL,
        parent_id INTEGER,
        rule_type TEXT NOT NULL CHECK (rule_type IN ('vendor', 'collection', 'category', 'product')),
        rule_value TEXT NOT NULL,
        rule_id TEXT,
        operator TEXT NOT NULL CHECK (operator IN ('AND', 'OR')),
        level INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (configuration_id) REFERENCES configurations (id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES configuration_rules (id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_configurations_shop ON configurations(shop)
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_configurations_priority ON configurations(priority DESC)
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_configuration_rules_config_id ON configuration_rules(configuration_id)
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_configuration_rules_parent_id ON configuration_rules(parent_id)
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

  close() {
    this.db.close();
  }
}

const database = new Database();

export default database;