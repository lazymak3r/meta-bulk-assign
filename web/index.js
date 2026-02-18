// @ts-check
import "dotenv/config";
import { join } from "path";
import { readFileSync } from "fs";
import multer from "multer";
import express from "express";
import serveStatic from "serve-static";

import configurationRoutes from "./configuration-routes.js";
import resourceRoutes from "./resource-routes.js";
import syncRoutes from "./sync-routes.js";
import shopify from "./shopify.js";
import database from "./database.js";
import AppWebhookHandlers from "./webhooks.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { uploadFileToShopify } from "./file-upload.js";
import * as metaobjectHandler from "./metaobject-handler.js";
import { syncStorefrontConfig } from "./storefront-config-sync.js";
import { appProxyAuthMiddleware } from "./app-proxy-auth.js";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/web/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

// Initialize database before handling requests
let dbInitialized = false;
let dbInitPromise = null;

async function initializeDatabase() {
  if (!dbInitialized && !dbInitPromise) {
    dbInitPromise = database.initialize().then(() => {
      dbInitialized = true;
      console.log("[Server] Database initialized successfully");
    }).catch((error) => {
      console.error("[Server] Failed to initialize database:", error);
      dbInitPromise = null; // Allow retry
      throw error;
    });
  }
  return dbInitPromise;
}

// Middleware to ensure database is initialized before handling requests
app.use(async (req, res, next) => {
  try {
    await initializeDatabase();
    next();
  } catch (error) {
    console.error("[Server] Database initialization failed:", error);
    res.status(500).json({
      error: "Database initialization failed",
      message: error.message,
    });
  }
});

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  (req, res, next) => {
    console.log("[Server] ===== WEBHOOK RECEIVED =====");
    console.log("[Server] Topic:", req.headers["x-shopify-topic"]);
    console.log("[Server] Shop:", req.headers["x-shopify-shop-domain"]);
    console.log("[Server] Webhook ID:", req.headers["x-shopify-webhook-id"]);
    next();
  },
  shopify.processWebhooks({
    webhookHandlers: { ...PrivacyWebhookHandlers, ...AppWebhookHandlers }
  })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

// App Proxy route for storefront
// Note: App proxy strips /apps/meta-bulk-assign prefix, so this route receives /storefront-config
// OPTIMIZED: Uses a single batched GraphQL query instead of multiple sequential calls
// SECURITY: Validates HMAC signature from Shopify to ensure request authenticity
app.get(
  "/storefront-config",
  appProxyAuthMiddleware(process.env.SHOPIFY_API_SECRET),
  async (req, res) => {
  try {
    const startTime = Date.now();
    const { shop, product } = req.query;

    if (!shop || !product) {
      return res.status(400).json({ error: "Missing shop or product parameter" });
    }

    // Step 1: Get all configurations and their rules in parallel
    const [configsResult, session] = await Promise.all([
      database.query(
        `SELECT c.id, c.metafield_configs
         FROM configurations c
         WHERE c.shop = ?
         ORDER BY c.priority DESC`,
        [shop]
      ),
      getShopSession(shop)
    ]);

    if (!configsResult.rows || configsResult.rows.length === 0) {
      console.log('[Storefront API] No configurations found for shop');
      return res.json({ metafields: [] });
    }

    if (!session) {
      console.error('[Storefront API] No session available for shop:', shop);
      return res.status(500).json({ error: 'No session available' });
    }

    console.log(`[Storefront API] Found ${configsResult.rows.length} configurations (${Date.now() - startTime}ms)`);

    // Step 2: Collect all metafield namespaces/keys that have displayType set
    // and get rules for all configurations in parallel
    const configsWithRules = await Promise.all(
      configsResult.rows.map(async (config) => {
        const metafieldConfigs = typeof config.metafield_configs === 'string'
          ? JSON.parse(config.metafield_configs)
          : config.metafield_configs;

        const rules = await database.getConfigurationRules(config.id);

        return {
          ...config,
          metafieldConfigs,
          rules
        };
      })
    );

    // Collect unique metafields with displayType
    const metafieldKeys = new Set();
    const metafieldDisplayTypes = new Map(); // Map of "namespace.key" -> displayType

    for (const config of configsWithRules) {
      for (const mf of config.metafieldConfigs) {
        if (mf.displayType && mf.displayType !== '') {
          const key = `${mf.namespace}.${mf.key}`;
          metafieldKeys.add(key);
          metafieldDisplayTypes.set(key, mf.displayType);
        }
      }
    }

    if (metafieldKeys.size === 0) {
      console.log('[Storefront API] No metafields with displayType found');
      return res.json({ metafields: [] });
    }

    console.log(`[Storefront API] Found ${metafieldKeys.size} unique metafields with displayType (${Date.now() - startTime}ms)`);

    // Step 3: Build a SINGLE GraphQL query that fetches product data AND all metafields
    const metafieldAliases = Array.from(metafieldKeys).map((key, index) => {
      const [namespace, keyName] = key.split('.');
      return `mf${index}: metafield(namespace: "${namespace}", key: "${keyName}") {
        id
        namespace
        key
        value
        type
        reference {
          ... on MediaImage {
            image {
              url
            }
          }
          ... on GenericFile {
            url
          }
          ... on Metaobject {
            id
            fields {
              key
              value
              type
              reference {
                ... on MediaImage {
                  image {
                    url
                  }
                }
                ... on GenericFile {
                  url
                }
              }
            }
          }
        }
        references(first: 50) {
          nodes {
            ... on MediaImage {
              image {
                url
              }
            }
            ... on GenericFile {
              url
            }
            ... on Metaobject {
              id
              fields {
                key
                value
                type
                reference {
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                  ... on GenericFile {
                    url
                  }
                }
              }
            }
          }
        }
      }`;
    });

    const batchedQuery = `
      query GetProductWithMetafields($handle: String!) {
        productByHandle(handle: $handle) {
          id
          vendor
          productType
          collections(first: 100) {
            edges {
              node {
                id
                handle
                title
              }
            }
          }
          ${metafieldAliases.join('\n          ')}
        }
      }
    `;

    const client = new shopify.api.clients.Graphql({ session });
    const response = await client.request(batchedQuery, {
      variables: { handle: product }
    });

    const productData = response.data?.productByHandle;
    if (!productData) {
      return res.json({ metafields: [] });
    }

    // Step 4: Check rules and collect metafields to display
    const metafieldsToDisplay = [];
    const processedKeys = new Set(); // Avoid duplicates

    for (const config of configsWithRules) {
      // Check if config applies to this product (using local data, no API call)
      const appliesToProduct = checkIfConfigAppliesLocal(productData, config.rules);

      if (!appliesToProduct) {
        continue;
      }

      // Process metafields from this configuration
      for (const mf of config.metafieldConfigs) {
        if (!mf.displayType || mf.displayType === '') {
          continue;
        }

        const key = `${mf.namespace}.${mf.key}`;
        if (processedKeys.has(key)) {
          continue; // Already added from a higher priority config
        }

        // Find the metafield in the response
        const metafieldIndex = Array.from(metafieldKeys).indexOf(key);
        const metafieldData = productData[`mf${metafieldIndex}`];

        if (!metafieldData) {
          continue;
        }

        // Process the metafield value
        const value = processMetafieldValue(metafieldData);

        if (value) {
          processedKeys.add(key);
          metafieldsToDisplay.push({
            namespace: mf.namespace,
            key: mf.key,
            displayType: mf.displayType,
            value: value,
            showOnStorefront: true,
          });
        }
      }
    }

    res.json({ metafields: metafieldsToDisplay });

  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Helper function to check if configuration applies to product using local data (no API call)
function checkIfConfigAppliesLocal(productData, rules) {
  // If no rules, apply to all products
  if (!rules || rules.length === 0) {
    return true;
  }

  // Check if product matches any of the rules
  for (const rule of rules) {
    let matches = false;

    switch (rule.rule_type) {
      case 'vendor':
        matches = productData.vendor === rule.rule_value;
        break;

      case 'product':
        try {
          const productIds = JSON.parse(rule.rule_id);
          matches = Array.isArray(productIds) && productIds.includes(productData.id);
        } catch (e) {
          matches = productData.id === rule.rule_id;
        }
        break;

      case 'category':
        matches = productData.productType === rule.rule_value;
        break;

      case 'collection':
        try {
          const collectionIds = JSON.parse(rule.rule_id);
          if (Array.isArray(collectionIds)) {
            matches = productData.collections.edges.some(edge => collectionIds.includes(edge.node.id));
          } else {
            matches = productData.collections.edges.some(edge =>
              edge.node.id === rule.rule_id ||
              edge.node.handle === rule.rule_value ||
              edge.node.title === rule.rule_value
            );
          }
        } catch (e) {
          matches = productData.collections.edges.some(edge =>
            edge.node.id === rule.rule_id ||
            edge.node.handle === rule.rule_value ||
            edge.node.title === rule.rule_value
          );
        }
        break;
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

// Helper function to process metafield value from the batched response
function processMetafieldValue(metafield) {
  if (!metafield) {
    return null;
  }

  switch (metafield.type) {
    case 'file_reference':
      if (metafield.reference?.image) {
        return metafield.reference.image.url;
      } else if (metafield.reference?.url) {
        return metafield.reference.url;
      }
      return metafield.value;

    case 'list.file_reference':
      if (metafield.references?.nodes && metafield.references.nodes.length > 0) {
        const urls = metafield.references.nodes.map(node => {
          if (node.image) {
            return node.image.url;
          } else if (node.url) {
            return node.url;
          }
          return null;
        }).filter(url => url !== null);
        return JSON.stringify(urls);
      }
      return metafield.value;

    case 'list.metaobject_reference':
      if (metafield.references?.nodes && metafield.references.nodes.length > 0) {
        const metaobjectArray = metafield.references.nodes.map(node => {
          if (node.fields) {
            const metaobjectData = {};
            for (const field of node.fields) {
              if (field.reference?.image) {
                metaobjectData[field.key] = field.reference.image.url;
              } else if (field.reference?.url) {
                metaobjectData[field.key] = field.reference.url;
              } else {
                metaobjectData[field.key] = field.value;
              }
            }
            return metaobjectData;
          }
          return null;
        }).filter(obj => obj !== null);
        return JSON.stringify(metaobjectArray);
      }
      return metafield.value;

    case 'metaobject_reference':
      if (metafield.reference?.fields) {
        const metaobjectData = {};
        for (const field of metafield.reference.fields) {
          if (field.reference?.image) {
            metaobjectData[field.key] = field.reference.image.url;
          } else if (field.reference?.url) {
            metaobjectData[field.key] = field.reference.url;
          } else {
            metaobjectData[field.key] = field.value;
          }
        }
        return JSON.stringify(metaobjectData);
      }
      return metafield.value;

    default:
      return metafield.value;
  }
}

// Helper function to get session for shop
async function getShopSession(shop) {
  try {
    // Get all sessions for this shop from session storage
    const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);

    if (!sessions || sessions.length === 0) {
      return null;
    }

    // Return the most recent active session
    // Filter for online sessions first, fall back to offline
    const onlineSession = sessions.find(s => s.isOnline);
    const offlineSession = sessions.find(s => !s.isOnline);

    return onlineSession || offlineSession || sessions[0];
  } catch (error) {
    return null;
  }
}

app.use("/api/*", shopify.validateAuthenticatedSession());

// Configure multer for file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max file size
  },
});

// File upload endpoint - MUST come before express.json() to avoid parsing multipart as JSON
app.post("/api/files/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    const session = res.locals.shopify.session;

    // Upload file to Shopify
    const fileData = await uploadFileToShopify(
      session,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    res.status(200).json({
      success: true,
      file: fileData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.use(express.json());

// List existing files from Shopify admin
app.get("/api/files/list", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const { type = "all", search = "", cursor = null, limit = 20 } = req.query;

    // Build query filter
    let queryFilter = "status:READY";
    if (type === "image") {
      queryFilter += " AND media_type:IMAGE";
    } else if (type === "file") {
      queryFilter += " AND media_type:GENERIC_FILE";
    }
    if (search) {
      queryFilter += ` AND filename:*${search}*`;
    }

    const response = await client.request(`
      query GetFiles($first: Int!, $after: String, $query: String) {
        files(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              createdAt
              fileStatus
              alt
              ... on MediaImage {
                image {
                  url
                  width
                  height
                }
                mimeType
              }
              ... on GenericFile {
                url
                mimeType
                originalFileSize
              }
              ... on Video {
                sources {
                  url
                  mimeType
                }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `, {
      variables: {
        first: parseInt(limit),
        after: cursor || null,
        query: queryFilter,
      },
    });

    const files = response.data.files.edges.map(({ node, cursor }) => {
      let url = null;
      let filename = "Unknown";
      let mimeType = null;
      let fileSize = null;

      if (node.image) {
        // MediaImage
        url = node.image.url;
        mimeType = node.mimeType;
        // Extract filename from URL
        const urlParts = node.image.url.split("/");
        filename = urlParts[urlParts.length - 1].split("?")[0];
      } else if (node.url) {
        // GenericFile
        url = node.url;
        mimeType = node.mimeType;
        fileSize = node.originalFileSize;
        const urlParts = node.url.split("/");
        filename = urlParts[urlParts.length - 1].split("?")[0];
      } else if (node.sources && node.sources.length > 0) {
        // Video
        url = node.sources[0].url;
        mimeType = node.sources[0].mimeType;
        const urlParts = node.sources[0].url.split("/");
        filename = urlParts[urlParts.length - 1].split("?")[0];
      }

      return {
        id: node.id,
        filename,
        url,
        mimeType,
        fileSize,
        alt: node.alt,
        createdAt: node.createdAt,
        cursor,
      };
    });

    res.status(200).json({
      success: true,
      files,
      pageInfo: response.data.files.pageInfo,
    });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/products/count", async (_req, res) => {
  const client = new shopify.api.clients.Graphql({
    session: res.locals.shopify.session,
  });

  const countData = await client.request(`
    query shopifyProductCount {
      productsCount {
        count
      }
    }
  `);

  res.status(200).send({ count: countData.data.productsCount.count });
});

app.post("/api/products", async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    await productCreator(res.locals.shopify.session);
  } catch (e) {
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
});

// Configuration routes
app.use("/api/configurations", configurationRoutes);

// Resource routes (vendors, collections, categories, products)
app.use("/api", resourceRoutes);

// Sync routes (file sync feature)
app.use("/api/sync", syncRoutes);

// Metafield definitions endpoint - fetches ALL definitions with pagination
app.get("/api/metafield-definitions", async (_req, res) => {
  try {
    const client = new shopify.api.clients.Graphql({
      session: res.locals.shopify.session,
    });

    const query = `
      query GetMetafieldDefinitions($cursor: String) {
        metafieldDefinitions(first: 250, after: $cursor, ownerType: PRODUCT) {
          edges {
            node {
              id
              name
              namespace
              key
              type {
                name
              }
              description
              validations {
                name
                value
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

    let allDefinitions = [];
    let hasNextPage = true;
    let cursor = null;

    // Fetch all pages
    while (hasNextPage) {
      const response = await client.request(query, {
        variables: { cursor },
      });

      const { edges, pageInfo } = response.data.metafieldDefinitions;
      const definitions = edges.map((edge) => edge.node);
      allDefinitions = allDefinitions.concat(definitions);

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
    }

    res.status(200).json({
      definitions: allDefinitions,
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Metaobject definition endpoint
app.get("/api/metaobject-definitions/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const definitionId = decodeURIComponent(req.params.id);

    const definition = await metaobjectHandler.getMetaobjectDefinition(session, definitionId);

    res.status(200).json({
      definition,
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Fetch a metaobject by ID
app.get("/api/metaobjects/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { id } = req.params;

    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      query GetMetaobject($id: ID!) {
        metaobject(id: $id) {
          id
          type
          handle
          fields {
            key
            value
            type
            reference {
              ... on MediaImage {
                image {
                  url
                }
              }
              ... on GenericFile {
                url
              }
            }
          }
        }
      }
    `;

    const response = await client.request(query, {
      variables: { id: `gid://shopify/Metaobject/${id}` }
    });

    const metaobject = response.data.metaobject;

    // Keep GIDs as-is for file references (needed for re-saving)
    // The frontend already displays "File uploaded: gid://..." which is fine

    res.json({
      success: true,
      metaobject,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Metaobject create/update endpoint
app.post("/api/metaobjects", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { metaobjectType, definitionId, fieldValues, metaobjectId } = req.body;

    // Fetch the metaobject definition
    const definition = await metaobjectHandler.getMetaobjectDefinition(session, definitionId);

    let resultId;

    if (metaobjectId) {
      // Update existing metaobject
      resultId = await metaobjectHandler.updateMetaobject(session, metaobjectId, fieldValues, definition);
    } else {
      // Create new metaobject
      resultId = await metaobjectHandler.createMetaobject(session, metaobjectType, fieldValues, definition);
    }

    res.status(200).json({
      success: true,
      metaobjectId: resultId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Manual sync of storefront config to shop metafield
// Call this to sync existing configurations for instant display
app.post("/api/sync-storefront-config", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const displayTypeMap = await syncStorefrontConfig(session);

    res.status(200).json({
      success: true,
      message: "Storefront config synced successfully",
      config: displayTypeMap,
    });
  } catch (error) {
    console.error("[API] Error syncing storefront config:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

// For Vercel serverless deployment
export default app;

// For local development
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
  });
}
