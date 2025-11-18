import sqlite3 from "sqlite3";
import { promisify } from "util";

const DB_PATH = `${process.cwd()}/database.sqlite`;

// Create a promise-based wrapper for sqlite3
class Database {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
    this.run = promisify(this.db.run.bind(this.db));
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));
  }

  async initialize() {
    await this.run(`
      CREATE TABLE IF NOT EXISTS vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop TEXT NOT NULL,
        vendor_name TEXT NOT NULL,
        product_count INTEGER DEFAULT 0,
        has_config BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shop, vendor_name)
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS vendor_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        metafield_configs TEXT NOT NULL,
        file_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE CASCADE,
        UNIQUE(vendor_id)
      )
    `);

    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_vendors_shop ON vendors(shop)
    `);

    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_vendors_shop_name ON vendors(shop, vendor_name)
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS vendor_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        shop TEXT NOT NULL,
        shopify_file_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT,
        file_url TEXT,
        file_size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE CASCADE
      )
    `);

    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_vendor_files_vendor ON vendor_files(vendor_id)
    `);

    console.log("Database initialized successfully");
  }

  // Vendor operations
  async getOrCreateVendor(shop, vendorName) {
    let vendor = await this.get(
      "SELECT * FROM vendors WHERE shop = ? AND vendor_name = ?",
      [shop, vendorName]
    );

    if (!vendor) {
      await this.run(
        "INSERT INTO vendors (shop, vendor_name, product_count, has_config) VALUES (?, ?, 0, 0)",
        [shop, vendorName]
      );
      vendor = await this.get(
        "SELECT * FROM vendors WHERE shop = ? AND vendor_name = ?",
        [shop, vendorName]
      );
    }

    return vendor;
  }

  async getAllVendors(shop) {
    return await this.all(
      `SELECT v.*, vc.metafield_configs, vc.file_id
       FROM vendors v
       LEFT JOIN vendor_configs vc ON v.id = vc.vendor_id
       WHERE v.shop = ?
       ORDER BY v.vendor_name`,
      [shop]
    );
  }

  async getVendorByName(shop, vendorName) {
    return await this.get(
      `SELECT v.*, vc.metafield_configs, vc.file_id
       FROM vendors v
       LEFT JOIN vendor_configs vc ON v.id = vc.vendor_id
       WHERE v.shop = ? AND v.vendor_name = ?`,
      [shop, vendorName]
    );
  }

  async updateVendorProductCount(shop, vendorName, count) {
    await this.run(
      "UPDATE vendors SET product_count = ?, updated_at = CURRENT_TIMESTAMP WHERE shop = ? AND vendor_name = ?",
      [count, shop, vendorName]
    );
  }

  // Vendor config operations
  async saveVendorConfig(vendorId, metafieldConfigs, fileId = null) {
    const existing = await this.get(
      "SELECT * FROM vendor_configs WHERE vendor_id = ?",
      [vendorId]
    );

    if (existing) {
      await this.run(
        `UPDATE vendor_configs
         SET metafield_configs = ?, file_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE vendor_id = ?`,
        [JSON.stringify(metafieldConfigs), fileId, vendorId]
      );
    } else {
      await this.run(
        `INSERT INTO vendor_configs (vendor_id, metafield_configs, file_id)
         VALUES (?, ?, ?)`,
        [vendorId, JSON.stringify(metafieldConfigs), fileId]
      );
    }

    // Update vendor has_config flag
    await this.run(
      "UPDATE vendors SET has_config = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [vendorId]
    );
  }

  async getVendorConfig(vendorId) {
    const config = await this.get(
      "SELECT * FROM vendor_configs WHERE vendor_id = ?",
      [vendorId]
    );

    if (config && config.metafield_configs) {
      config.metafield_configs = JSON.parse(config.metafield_configs);
    }

    return config;
  }

  async deleteVendorConfig(vendorId) {
    await this.run("DELETE FROM vendor_configs WHERE vendor_id = ?", [
      vendorId,
    ]);

    // Update vendor has_config flag
    await this.run(
      "UPDATE vendors SET has_config = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [vendorId]
    );
  }

  // Vendor file operations
  async saveVendorFile(vendorId, shop, fileData) {
    await this.run(
      `INSERT INTO vendor_files (vendor_id, shop, shopify_file_id, filename, file_type, file_url, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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

    return await this.get(
      "SELECT * FROM vendor_files WHERE id = last_insert_rowid()"
    );
  }

  async getVendorFiles(vendorId) {
    return await this.all(
      "SELECT * FROM vendor_files WHERE vendor_id = ? ORDER BY created_at DESC",
      [vendorId]
    );
  }

  async getFileById(fileId) {
    return await this.get(
      "SELECT * FROM vendor_files WHERE id = ?",
      [fileId]
    );
  }

  async getFileByGid(shop, shopifyFileId) {
    return await this.get(
      "SELECT * FROM vendor_files WHERE shop = ? AND shopify_file_id = ?",
      [shop, shopifyFileId]
    );
  }

  async deleteVendorFile(fileId) {
    await this.run("DELETE FROM vendor_files WHERE id = ?", [fileId]);
  }

  close() {
    this.db.close();
  }
}

const database = new Database(DB_PATH);

export default database;