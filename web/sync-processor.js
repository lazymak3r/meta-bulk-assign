/**
 * Sync Processor
 *
 * Core pipeline for transforming middleware-imported metafields into
 * Shopify-native file references. Downloads external files, uploads
 * to Shopify Files, and sets proper metafields on products.
 */

import axios from "axios";
import path from "path";
import shopify from "./shopify.js";
import database from "./database.js";
import { uploadFileToShopify } from "./file-upload.js";
import { applyMetafieldsToProduct } from "./metafield-apply.js";
import { syncStorefrontConfig } from "./storefront-config-sync.js";
import { throttledQuery, withRetry, sleep } from "./rate-limiter.js";

// Track active jobs for cancellation
const activeJobs = new Map();

/**
 * Start a sync job (called async, not awaited)
 */
export async function processSyncJob(session, jobId, mappings) {
  const shop = session.shop;
  activeJobs.set(jobId, { cancelled: false });

  try {
    await database.updateSyncJobStatus(jobId, {
      status: "running",
      started_at: new Date().toISOString(),
    });

    const client = new shopify.api.clients.Graphql({ session });

    // Step 1: Count and fetch products with source metafields
    console.log(`[Sync] Job ${jobId}: Starting product scan for ${mappings.length} mappings`);
    const products = await fetchProductsWithMetafields(client, mappings, jobId);

    await database.updateSyncJobStatus(jobId, {
      total_products: products.length,
    });

    if (products.length === 0) {
      await database.updateSyncJobStatus(jobId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
      activeJobs.delete(jobId);
      return;
    }

    // Step 2: Process each product
    let processed = 0;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    let filesUploaded = 0;
    let filesSkipped = 0;
    const errors = [];
    const fileProductMap = {};

    for (const product of products) {
      // Check cancellation
      if (processed % 10 === 0) {
        const jobState = activeJobs.get(jobId);
        if (jobState?.cancelled) {
          console.log(`[Sync] Job ${jobId}: Cancelled by user`);
          await database.updateSyncJobStatus(jobId, {
            status: "cancelled",
            processed_products: processed,
            successful_products: successful,
            failed_products: failed,
            skipped_products: skipped,
            total_files_uploaded: filesUploaded,
            total_files_skipped: filesSkipped,
            errors,
            completed_at: new Date().toISOString(),
          });
          activeJobs.delete(jobId);
          return;
        }
      }

      try {
        const result = await processProduct(session, shop, product, mappings);

        if (result.skipped) {
          skipped++;
        } else {
          successful++;
        }
        filesUploaded += result.filesUploaded;
        filesSkipped += result.filesSkipped;

        // Accumulate file→product map
        for (const fa of result.fileAssignments) {
          const mapping = mappings[fa.mappingIndex];
          if (!fileProductMap[fa.fileGid]) {
            fileProductMap[fa.fileGid] = {
              filename: fa.filename,
              displayType: mapping.target_display_type,
              targetNamespace: mapping.target_namespace,
              targetKey: mapping.target_key,
              targetType: mapping.target_metafield_type,
              products: [],
            };
          }
          const entry = fileProductMap[fa.fileGid];
          if (!entry.products.some(p => p.id === product.id)) {
            entry.products.push({ id: product.id, title: product.title });
          }
        }
      } catch (error) {
        failed++;
        errors.push({
          productId: product.id,
          productTitle: product.title,
          error: error.message,
        });
        console.error(`[Sync] Job ${jobId}: Failed product ${product.id}: ${error.message}`);
      }

      processed++;

      // Update progress every 5 products
      if (processed % 5 === 0 || processed === products.length) {
        await database.updateSyncJobStatus(jobId, {
          processed_products: processed,
          successful_products: successful,
          failed_products: failed,
          skipped_products: skipped,
          total_files_uploaded: filesUploaded,
          total_files_skipped: filesSkipped,
          errors,
        });
      }

      // Throttle between products
      if (processed < products.length) {
        await sleep(200);
      }
    }

    // Step 3: Create configurations for each unique file
    console.log(`[Sync] Job ${jobId}: Creating configurations from file map (${Object.keys(fileProductMap).length} files)`);
    await createConfigurationsFromFileMap(session, shop, fileProductMap);

    // Step 4: Sync storefront config
    await syncStorefrontConfig(session);

    await database.updateSyncJobStatus(jobId, {
      status: "completed",
      processed_products: processed,
      successful_products: successful,
      failed_products: failed,
      skipped_products: skipped,
      total_files_uploaded: filesUploaded,
      total_files_skipped: filesSkipped,
      errors,
      completed_at: new Date().toISOString(),
    });

    console.log(`[Sync] Job ${jobId}: Completed. ${successful} successful, ${failed} failed, ${skipped} skipped`);
  } catch (error) {
    console.error(`[Sync] Job ${jobId}: Fatal error:`, error);
    await database.updateSyncJobStatus(jobId, {
      status: "failed",
      errors: [{ productId: null, productTitle: null, error: error.message }],
      completed_at: new Date().toISOString(),
    });
  } finally {
    activeJobs.delete(jobId);
  }
}

/**
 * Cancel a running sync job
 */
export function cancelSyncJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    return true;
  }
  return false;
}

/**
 * Check if a job is currently active
 */
export function isJobActive(jobId) {
  return activeJobs.has(jobId);
}

/**
 * Fetch all products that have at least one source metafield populated
 */
async function fetchProductsWithMetafields(client, mappings, jobId) {
  // Build dynamic metafield aliases for the query
  const metafieldAliases = mappings.map((m, i) =>
    `mf${i}: metafield(namespace: "${m.source_namespace}", key: "${m.source_key}") { value type }`
  ).join("\n        ");

  const query = `
    query GetProductsForSync($cursor: String) {
      products(first: 250, after: $cursor) {
        edges {
          node {
            id
            title
            ${metafieldAliases}
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    // Check cancellation during fetch
    const jobState = activeJobs.get(jobId);
    if (jobState?.cancelled) break;

    const response = await throttledQuery(client, query, { cursor });
    const { edges, pageInfo } = response.data.products;

    for (const edge of edges) {
      const product = edge.node;
      // Check if product has at least one non-empty source metafield
      const hasData = mappings.some((_, i) => {
        const mf = product[`mf${i}`];
        return mf && mf.value && mf.value.trim() !== "";
      });
      if (hasData) {
        allProducts.push(product);
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  console.log(`[Sync] Job ${jobId}: Found ${allProducts.length} products with source metafield data`);
  return allProducts;
}

/**
 * Process a single product: extract URLs, download, upload, set metafields
 */
async function processProduct(session, shop, product, mappings) {
  const metafieldConfigs = [];
  let filesUploaded = 0;
  let filesSkipped = 0;
  let hasAnyData = false;
  const fileAssignments = [];

  for (let i = 0; i < mappings.length; i++) {
    const mapping = mappings[i];
    const mf = product[`mf${i}`];

    if (!mf || !mf.value || mf.value.trim() === "") continue;

    // Extract URLs from the metafield value
    const urls = extractUrls(mf.value);
    if (urls.length === 0) continue;

    hasAnyData = true;
    const fileGids = [];

    for (const url of urls) {
      try {
        // Check cache first
        const cached = await database.getCachedFile(shop, url);
        if (cached) {
          fileGids.push(cached.shopify_file_gid);
          filesSkipped++;
          fileAssignments.push({
            fileGid: cached.shopify_file_gid,
            filename: cached.filename || extractFilenameFromUrl(url),
            mappingIndex: i,
          });
          continue;
        }

        // Download and upload
        const result = await downloadAndUpload(session, url);
        if (result) {
          fileGids.push(result.shopifyFileId);
          filesUploaded++;
          fileAssignments.push({
            fileGid: result.shopifyFileId,
            filename: result.filename,
            mappingIndex: i,
          });

          // Cache the result
          await database.cacheFile(shop, url, result.shopifyFileId, result.filename, result.mimeType);
        }
      } catch (error) {
        console.warn(`[Sync] Failed to process URL ${url} for product ${product.id}: ${error.message}`);
        // Continue with other URLs
      }
    }

    if (fileGids.length > 0) {
      // Auto-upgrade file_reference → list.file_reference when multiple files
      let targetType = mapping.target_metafield_type;
      if (fileGids.length > 1 && targetType === "file_reference") {
        console.log(`[Sync] Product ${product.id}: Auto-upgrading ${mapping.target_namespace}.${mapping.target_key} to list.file_reference (${fileGids.length} files)`);
        targetType = "list.file_reference";
      }

      console.log(`[Sync] Product ${product.id}: Setting ${mapping.target_namespace}.${mapping.target_key} (${targetType}) with GIDs:`, fileGids);
      metafieldConfigs.push({
        namespace: mapping.target_namespace,
        key: mapping.target_key,
        type: targetType,
        value: fileGids,
      });
    }
  }

  if (!hasAnyData) {
    return { skipped: true, filesUploaded: 0, filesSkipped: 0, fileAssignments: [] };
  }

  if (metafieldConfigs.length > 0) {
    await applyMetafieldsToProduct(session, product.id, metafieldConfigs);
  }

  return { skipped: false, filesUploaded, filesSkipped, fileAssignments };
}

/**
 * Extract URLs from a metafield value. Handles:
 * - Single URL string
 * - JSON array of URLs: ["url1", "url2"]
 * - JSON object with URL values: {"image_url":"http://...","label":"A"}
 * - JSON array of objects with URL values: [{"image_url":"http://..."}, ...]
 * - Comma-separated URLs
 */
function extractUrls(value) {
  // Try JSON first
  try {
    const parsed = JSON.parse(value);
    const urls = collectUrlsFromJson(parsed);
    if (urls.length > 0) return urls;
  } catch {
    // Not JSON
  }

  // Try comma-separated
  const parts = value.split(",").map(s => s.trim());
  if (parts.length > 1 && parts.every(p => isUrl(p))) {
    return parts;
  }

  // Single URL
  if (isUrl(value.trim())) {
    return [value.trim()];
  }

  return [];
}

/**
 * Recursively collect all URL strings from a parsed JSON value
 */
function collectUrlsFromJson(data) {
  const urls = [];
  if (typeof data === "string" && isUrl(data.trim())) {
    urls.push(data.trim());
  } else if (Array.isArray(data)) {
    for (const item of data) {
      urls.push(...collectUrlsFromJson(item));
    }
  } else if (data && typeof data === "object") {
    for (const val of Object.values(data)) {
      urls.push(...collectUrlsFromJson(val));
    }
  }
  return urls;
}

/**
 * Check if a string looks like a URL
 */
function isUrl(str) {
  return str.startsWith("http://") || str.startsWith("https://");
}

/**
 * Extract a clean filename from a URL, stripping query params and UUID suffixes
 */
function extractFilenameFromUrl(url) {
  try {
    const urlPath = new URL(url).pathname;
    let filename = path.basename(urlPath) || "file";
    // Strip UUID suffixes like _1b49aac7-b2d3-4304-b2be-9ebd1fc3082a before the extension
    filename = filename.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, "");
    return filename;
  } catch {
    return "file";
  }
}

/**
 * Download a file from external URL and upload to Shopify
 */
async function downloadAndUpload(session, url) {
  // Download with retry
  let buffer;
  let contentType;

  await withRetry(async () => {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 20 * 1024 * 1024,
    });
    buffer = Buffer.from(response.data);
    contentType = response.headers["content-type"]?.split(";")[0]?.trim() || "application/octet-stream";
  }, { maxRetries: 3, initialDelay: 2000 });

  // Validate content type
  const validTypes = [
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  ];
  if (!validTypes.some(t => contentType.startsWith(t))) {
    throw new Error(`Invalid content type: ${contentType}`);
  }

  // Extract filename from URL
  const urlPath = new URL(url).pathname;
  let filename = path.basename(urlPath) || "file";
  // Ensure extension matches content type
  if (!path.extname(filename)) {
    const extMap = {
      "application/pdf": ".pdf",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
    };
    filename += extMap[contentType] || "";
  }

  // Upload to Shopify
  const result = await uploadFileToShopify(session, buffer, filename, contentType);

  // Poll for file readiness
  await pollFileReady(session, result.shopifyFileId);

  return { shopifyFileId: result.shopifyFileId, filename, mimeType: contentType };
}

/**
 * Poll Shopify until a file is READY
 */
async function pollFileReady(session, fileGid) {
  const client = new shopify.api.clients.Graphql({ session });
  const query = `
    query CheckFileStatus($id: ID!) {
      node(id: $id) {
        ... on GenericFile { id fileStatus }
        ... on MediaImage { id fileStatus }
      }
    }
  `;

  let delay = 1000;
  const maxWait = 60000;
  let waited = 0;

  while (waited < maxWait) {
    await sleep(delay);
    waited += delay;

    try {
      const response = await throttledQuery(client, query, { id: fileGid });
      const status = response.data?.node?.fileStatus;

      if (status === "READY") return;
      if (status === "FAILED") throw new Error(`File processing failed: ${fileGid}`);
    } catch (error) {
      if (error.message.includes("File processing failed")) throw error;
      // Other errors: continue polling
    }

    delay = Math.min(delay * 1.5, 10000);
  }

  console.warn(`[Sync] File ${fileGid} not READY after ${maxWait}ms, proceeding anyway`);
}

/**
 * Create configurations for each mapping so they appear in the app and storefront
 */
async function createConfigurationsFromMappings(session, shop, mappings) {
  for (const mapping of mappings) {
    // Check if a configuration with this display type already exists
    const existingConfigs = await database.getAllConfigurations(shop);
    const alreadyExists = existingConfigs.some(config => {
      const mfConfigs = config.metafield_configs || [];
      return mfConfigs.some(mf =>
        mf.namespace === mapping.target_namespace &&
        mf.key === mapping.target_key &&
        mf.displayType === mapping.target_display_type
      );
    });

    if (alreadyExists) {
      console.log(`[Sync] Configuration for ${mapping.target_namespace}.${mapping.target_key} already exists, skipping`);
      continue;
    }

    const metafieldConfigs = [{
      namespace: mapping.target_namespace,
      key: mapping.target_key,
      type: mapping.target_metafield_type,
      displayType: mapping.target_display_type,
      value: [],
    }];

    await database.createConfiguration(
      shop,
      `Sync: ${mapping.target_display_type}`,
      "combined",
      metafieldConfigs,
      0
    );

    console.log(`[Sync] Created configuration for ${mapping.target_display_type}`);
  }
}

/**
 * Create per-file configurations from the accumulated file→product map.
 * Each unique file gets its own configuration named after the filename,
 * with a product rule listing all products that reference that file.
 */
export async function createConfigurationsFromFileMap(session, shop, fileProductMap) {
  const existingConfigs = await database.getAllConfigurations(shop);

  for (const [fileGid, entry] of Object.entries(fileProductMap)) {
    // Check if any existing configuration already references this file GID
    const alreadyExists = existingConfigs.some(config => {
      const mfConfigs = config.metafield_configs || [];
      return mfConfigs.some(mf =>
        Array.isArray(mf.value) && mf.value.includes(fileGid)
      );
    });

    if (alreadyExists) {
      console.log(`[Sync] Configuration for file ${fileGid} already exists, skipping`);
      continue;
    }

    const { filename, displayType, targetNamespace, targetKey, targetType, products } = entry;

    // Build a human-readable label from the display type
    const DISPLAY_TYPE_LABELS = {
      warranty_document: "Warranty",
      safety_document: "Safety",
      product_detail_icon: "Icon",
      energy_label: "Energy Label",
    };
    const typeLabel = DISPLAY_TYPE_LABELS[displayType] || displayType || "";
    const configName = typeLabel
      ? `${typeLabel} - ${filename || "Synced File"}`
      : (filename || "Synced File");

    // Create the configuration
    const metafieldConfigs = [{
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      namespace: targetNamespace,
      key: targetKey,
      type: targetType || "list.file_reference",
      displayType: displayType,
      value: [fileGid],
    }];

    const config = await database.createConfiguration(
      shop,
      configName,
      "product",
      metafieldConfigs,
      0
    );

    // Create product rule matching the format expected by RuleNode.jsx
    if (products && products.length > 0) {
      // Deduplicate products by ID
      const uniqueProducts = [];
      const seenIds = new Set();
      for (const p of products) {
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          uniqueProducts.push(p);
        }
      }

      await database.createConfigurationRule(
        config.id,
        null,                                                          // parent_id
        "product",                                                     // rule_type
        JSON.stringify(uniqueProducts.map(p => ({ id: p.id, title: p.title }))), // rule_value
        JSON.stringify(uniqueProducts.map(p => p.id)),                 // rule_id
        "OR",                                                          // operator
        0,                                                             // level
        0                                                              // position
      );
    }

    console.log(`[Sync] Created configuration "${configName}" for file ${fileGid} with ${products?.length || 0} products`);
  }
}

/**
 * Fetch a single page of products with source metafield aliases.
 * Used by the batch processing endpoint.
 */
export async function fetchProductPage(client, mappings, cursor, pageSize = 100) {
  const metafieldAliases = mappings.map((m, i) =>
    `mf${i}: metafield(namespace: "${m.source_namespace}", key: "${m.source_key}") { value type }`
  ).join("\n        ");

  const query = `
    query GetProductsForSync($cursor: String, $first: Int!) {
      products(first: $first, after: $cursor) {
        edges {
          node {
            id
            title
            ${metafieldAliases}
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const response = await throttledQuery(client, query, { cursor, first: pageSize });
  const { edges, pageInfo } = response.data.products;

  return {
    products: edges.map(e => e.node),
    nextCursor: pageInfo.endCursor,
    hasNextPage: pageInfo.hasNextPage,
  };
}

export { processProduct, createConfigurationsFromMappings, extractFilenameFromUrl };

export default {
  processSyncJob,
  cancelSyncJob,
  isJobActive,
  fetchProductPage,
  processProduct,
  createConfigurationsFromMappings,
  createConfigurationsFromFileMap,
};
