/**
 * Sync Routes
 *
 * Express router for the file sync feature. Handles mapping CRUD,
 * source metafield discovery, and sync job lifecycle.
 */

import express from "express";
import shopify from "./shopify.js";
import database from "./database.js";
import { processSyncJob, cancelSyncJob, isJobActive } from "./sync-processor.js";
import { throttledQuery } from "./rate-limiter.js";

const router = express.Router();

// Display type → target metafield mapping
const DISPLAY_TYPE_TARGETS = {
  warranty_document: { namespace: "custom", key: "warranty" },
  safety_document: { namespace: "custom", key: "safety_document" },
  product_detail_icon: { namespace: "custom", key: "icons_logos" },
};

// ─── Mappings CRUD ───────────────────────────────────────────────

/**
 * GET /api/sync/mappings
 * List all sync mappings for the shop
 */
router.get("/mappings", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const mappings = await database.getSyncMappings(session.shop);
    res.json(mappings);
  } catch (error) {
    console.error("[Sync Routes] Error fetching mappings:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sync/mappings
 * Create a new sync mapping
 */
router.post("/mappings", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { source_namespace, source_key, target_display_type } = req.body;

    if (!source_namespace || !source_key || !target_display_type) {
      return res.status(400).json({
        error: "source_namespace, source_key, and target_display_type are required",
      });
    }

    const target = DISPLAY_TYPE_TARGETS[target_display_type];
    if (!target) {
      return res.status(400).json({
        error: `Invalid target_display_type. Allowed: ${Object.keys(DISPLAY_TYPE_TARGETS).join(", ")}`,
      });
    }

    const mapping = await database.createSyncMapping(session.shop, {
      source_namespace,
      source_key,
      target_display_type,
      target_namespace: target.namespace,
      target_key: target.key,
      target_metafield_type: "list.file_reference",
    });

    res.status(201).json(mapping);
  } catch (error) {
    console.error("[Sync Routes] Error creating mapping:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/sync/mappings/:id
 * Update an existing sync mapping
 */
router.put("/mappings/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const mappingId = parseInt(req.params.id, 10);

    // Verify ownership
    const existing = await database.getSyncMappingById(mappingId);
    if (!existing) {
      return res.status(404).json({ error: "Mapping not found" });
    }
    if (existing.shop !== session.shop) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { source_namespace, source_key, target_display_type, enabled } = req.body;
    const updates = {};

    if (source_namespace !== undefined) updates.source_namespace = source_namespace;
    if (source_key !== undefined) updates.source_key = source_key;
    if (enabled !== undefined) updates.enabled = enabled;

    if (target_display_type !== undefined) {
      const target = DISPLAY_TYPE_TARGETS[target_display_type];
      if (!target) {
        return res.status(400).json({
          error: `Invalid target_display_type. Allowed: ${Object.keys(DISPLAY_TYPE_TARGETS).join(", ")}`,
        });
      }
      updates.target_display_type = target_display_type;
      updates.target_namespace = target.namespace;
      updates.target_key = target.key;
    }

    const updated = await database.updateSyncMapping(mappingId, updates);
    res.json(updated);
  } catch (error) {
    console.error("[Sync Routes] Error updating mapping:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/sync/mappings/:id
 * Delete a sync mapping
 */
router.delete("/mappings/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const mappingId = parseInt(req.params.id, 10);

    // Verify ownership
    const existing = await database.getSyncMappingById(mappingId);
    if (!existing) {
      return res.status(404).json({ error: "Mapping not found" });
    }
    if (existing.shop !== session.shop) {
      return res.status(403).json({ error: "Access denied" });
    }

    await database.deleteSyncMapping(mappingId);
    res.json({ success: true });
  } catch (error) {
    console.error("[Sync Routes] Error deleting mapping:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Source Metafield Discovery ──────────────────────────────────

/**
 * GET /api/sync/source-metafields
 * Fetch ALL product metafield definitions (both structured and unstructured).
 * 1. Fetches formal metafieldDefinitions from the API
 * 2. Scans a sample of products to discover unstructured metafields
 * Combines and deduplicates both lists.
 */
router.get("/source-metafields", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    // Step 1: Fetch all formal metafield definitions
    const definitionsQuery = `
      query GetMetafieldDefinitions($cursor: String) {
        metafieldDefinitions(first: 250, after: $cursor, ownerType: PRODUCT) {
          edges {
            node {
              id
              name
              namespace
              key
              type { name }
              description
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const definitionsMap = new Map(); // key: "namespace.key" → definition object
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const response = await throttledQuery(client, definitionsQuery, { cursor });
      const { edges, pageInfo } = response.data.metafieldDefinitions;

      for (const edge of edges) {
        const def = edge.node;
        definitionsMap.set(`${def.namespace}.${def.key}`, {
          id: def.id,
          name: def.name,
          namespace: def.namespace,
          key: def.key,
          type: def.type,
          description: def.description,
          source: "definition",
        });
      }

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
    }

    // Step 2: Scan products to discover unstructured metafields
    const productsQuery = `
      query GetProductMetafields($cursor: String) {
        products(first: 50, after: $cursor) {
          edges {
            node {
              metafields(first: 100) {
                edges {
                  node {
                    namespace
                    key
                    type
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    // Scan up to 250 products (5 pages of 50) to discover unstructured metafields
    let productCursor = null;
    let productPages = 0;
    const MAX_PRODUCT_PAGES = 5;

    while (productPages < MAX_PRODUCT_PAGES) {
      const response = await throttledQuery(client, productsQuery, { cursor: productCursor });
      const { edges, pageInfo } = response.data.products;

      for (const productEdge of edges) {
        for (const mfEdge of productEdge.node.metafields.edges) {
          const mf = mfEdge.node;
          const mapKey = `${mf.namespace}.${mf.key}`;

          if (!definitionsMap.has(mapKey)) {
            definitionsMap.set(mapKey, {
              id: null,
              name: `${mf.namespace}.${mf.key}`,
              namespace: mf.namespace,
              key: mf.key,
              type: { name: mf.type },
              description: null,
              source: "unstructured",
            });
          }
        }
      }

      if (!pageInfo.hasNextPage) break;
      productCursor = pageInfo.endCursor;
      productPages++;
    }

    // Return all metafields sorted by namespace.key
    const allMetafields = Array.from(definitionsMap.values()).sort((a, b) =>
      `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`)
    );

    res.json(allMetafields);
  } catch (error) {
    console.error("[Sync Routes] Error fetching source metafields:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Sync Job Lifecycle ──────────────────────────────────────────

/**
 * POST /api/sync/start
 * Start a new sync job. Runs async — returns jobId immediately.
 */
router.post("/start", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shop = session.shop;

    // Check for active job
    const activeJob = await database.getActiveSyncJob(shop);
    if (activeJob) {
      return res.status(409).json({
        error: "A sync job is already running",
        jobId: activeJob.id,
      });
    }

    // Get enabled mappings
    const mappings = await database.getSyncMappings(shop);
    const enabledMappings = mappings.filter((m) => m.enabled);

    if (enabledMappings.length === 0) {
      return res.status(400).json({
        error: "No enabled sync mappings configured. Add at least one mapping before starting a sync.",
      });
    }

    // Create job record
    const job = await database.createSyncJob(shop, enabledMappings);

    // Start async processing (not awaited)
    processSyncJob(session, job.id, enabledMappings).catch((error) => {
      console.error(`[Sync Routes] Unhandled error in job ${job.id}:`, error);
    });

    res.status(202).json({
      jobId: job.id,
      status: "pending",
      mappings: enabledMappings.length,
    });
  } catch (error) {
    console.error("[Sync Routes] Error starting sync:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sync/jobs/latest
 * Get the latest sync job for the shop
 */
router.get("/jobs/latest", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const job = await database.getLatestSyncJob(session.shop);

    if (!job) {
      return res.json(null);
    }

    // Parse errors JSON
    if (typeof job.errors === "string") {
      try {
        job.errors = JSON.parse(job.errors);
      } catch {
        job.errors = [];
      }
    }

    res.json(job);
  } catch (error) {
    console.error("[Sync Routes] Error fetching latest job:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sync/jobs/:id
 * Get a specific sync job by ID (used for polling)
 */
router.get("/jobs/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const jobId = parseInt(req.params.id, 10);
    const job = await database.getSyncJob(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.shop !== session.shop) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Parse errors JSON
    if (typeof job.errors === "string") {
      try {
        job.errors = JSON.parse(job.errors);
      } catch {
        job.errors = [];
      }
    }

    res.json(job);
  } catch (error) {
    console.error("[Sync Routes] Error fetching job:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/sync/jobs/:id/cancel
 * Cancel a running sync job
 */
router.post("/jobs/:id/cancel", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const jobId = parseInt(req.params.id, 10);
    const job = await database.getSyncJob(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.shop !== session.shop) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (job.status !== "running" && job.status !== "pending") {
      return res.status(400).json({ error: `Cannot cancel job with status: ${job.status}` });
    }

    const cancelled = cancelSyncJob(jobId);
    if (!cancelled) {
      // Job is not active in memory (server restarted or serverless cold start)
      // Mark it as cancelled directly in the database
      await database.updateSyncJobStatus(jobId, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
      });
      return res.json({ success: true, message: "Job marked as cancelled (was not active in memory)" });
    }

    res.json({ success: true, message: "Cancellation requested" });
  } catch (error) {
    console.error("[Sync Routes] Error cancelling job:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Cache Info ──────────────────────────────────────────────────

/**
 * GET /api/sync/cache/stats
 * Get file cache statistics for the shop
 */
router.get("/cache/stats", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const cachedFiles = await database.getCachedFiles(session.shop);
    res.json({
      totalCached: cachedFiles.length,
      files: cachedFiles,
    });
  } catch (error) {
    console.error("[Sync Routes] Error fetching cache stats:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
