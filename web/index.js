// @ts-check
import "dotenv/config";
import { join } from "path";
import { readFileSync } from "fs";
import multer from "multer";
import express from "express";
import serveStatic from "serve-static";

import configurationRoutes from "./configuration-routes.js";
import resourceRoutes from "./resource-routes.js";
import shopify from "./shopify.js";
import database from "./database.js";
import AppWebhookHandlers from "./webhooks.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { uploadFileToShopify } from "./file-upload.js";
import * as metaobjectHandler from "./metaobject-handler.js";

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

// App Proxy route for storefront (no authentication required)
// Note: App proxy strips /apps/meta-bulk-assign prefix, so this route receives /storefront-config
app.get("/storefront-config", async (req, res) => {
  try {
    const { shop, product } = req.query;

    if (!shop || !product) {
      return res.status(400).json({ error: "Missing shop or product parameter" });
    }

    // Get all configurations for this shop
    // We'll filter by displayType instead of show_on_storefront
    const configs = await database.query(
      `SELECT id, metafield_configs
       FROM configurations
       WHERE shop = ?
       ORDER BY priority DESC`,
      [shop]
    );

    if (!configs.rows || configs.rows.length === 0) {
      console.log('[Storefront API] No configurations found for shop');
      return res.json({ metafields: [] });
    }

    console.log(`[Storefront API] Found ${configs.rows.length} configurations for shop`);

    // For each configuration, check if it applies to this product
    const metafieldsToDisplay = [];

    for (const config of configs.rows) {
      // Parse metafield configs
      const metafieldConfigs = typeof config.metafield_configs === 'string'
        ? JSON.parse(config.metafield_configs)
        : config.metafield_configs;

      console.log(`[Storefront API] Config ${config.id} has ${metafieldConfigs.length} metafield configs`);

      // Get rules for this configuration
      const rules = await database.getConfigurationRules(config.id);

      console.log(`[Storefront API] Config ${config.id} has ${rules.length} rules`);

      // Check if this configuration applies to the product
      const appliesToProduct = await checkIfConfigApplies(shop, product, rules);

      console.log(`[Storefront API] Config ${config.id} applies to product ${product}:`, appliesToProduct);

      if (appliesToProduct) {
        console.log(`[Storefront API] Config ${config.id} applies to product. Metafields in config:`, metafieldConfigs);

        // Add each metafield from this configuration
        for (const mf of metafieldConfigs) {
          console.log(`[Storefront API] Processing metafield ${mf.namespace}.${mf.key} with displayType: ${mf.displayType}`);

          // Only include metafields that have a display type set
          if (!mf.displayType || mf.displayType === '') {
            console.log(`[Storefront API] Skipping ${mf.namespace}.${mf.key} - no display type`);
            continue;
          }

          // Fetch the actual metafield value from Shopify
          const value = await fetchMetafieldValue(shop, product, mf.namespace, mf.key);

          console.log(`[Storefront API] Fetched value for ${mf.namespace}.${mf.key}:`, value ? 'HAS VALUE' : 'NULL');

          if (value) {
            metafieldsToDisplay.push({
              namespace: mf.namespace,
              key: mf.key,
              displayType: mf.displayType, // Use the displayType from config
              value: value,
              showOnStorefront: true,
            });
          }
        }
      }
    }

    res.json({ metafields: metafieldsToDisplay });

  } catch (error) {
    console.error('[Storefront API] Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Helper function to get session for shop
async function getShopSession(shop) {
  try {
    // Get all sessions for this shop from session storage
    const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);

    if (!sessions || sessions.length === 0) {
      console.error(`[Storefront API] No session found for shop: ${shop}`);
      return null;
    }

    // Return the most recent active session
    // Filter for online sessions first, fall back to offline
    const onlineSession = sessions.find(s => s.isOnline);
    const offlineSession = sessions.find(s => !s.isOnline);

    return onlineSession || offlineSession || sessions[0];
  } catch (error) {
    console.error('[Storefront API] Error getting session:', error);
    return null;
  }
}

// Helper function to check if configuration applies to product
async function checkIfConfigApplies(shop, productHandle, rules) {
  // If no rules, apply to all products
  if (!rules || rules.length === 0) {
    return true;
  }

  try {
    // Get session for this shop
    const session = await getShopSession(shop);
    if (!session) {
      console.error('[Storefront API] Cannot check rules - no session available');
      return false;
    }

    // Fetch product data to check against rules
    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      query GetProductByHandle($handle: String!) {
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
        }
      }
    `;

    const response = await client.request(query, {
      variables: { handle: productHandle }
    });

    const product = response.data?.productByHandle;
    if (!product) {
      return false;
    }

    // Check if product matches any of the rules
    for (const rule of rules) {
      let matches = false;

      switch (rule.rule_type) {
        case 'vendor':
          matches = product.vendor === rule.rule_value;
          break;

        case 'product':
          // Parse rule_id which contains JSON array of product IDs
          try {
            const productIds = JSON.parse(rule.rule_id);
            matches = Array.isArray(productIds) && productIds.includes(product.id);
          } catch (e) {
            // Fallback for non-JSON rule_id
            matches = product.id === rule.rule_id || productHandle === rule.rule_value;
          }
          break;

        case 'category':
          matches = product.productType === rule.rule_value;
          break;

        case 'collection':
          // Parse rule_id which may contain JSON array of collection IDs
          try {
            const collectionIds = JSON.parse(rule.rule_id);
            if (Array.isArray(collectionIds)) {
              matches = product.collections.edges.some(edge => collectionIds.includes(edge.node.id));
            } else {
              // Single collection ID
              matches = product.collections.edges.some(edge =>
                edge.node.id === rule.rule_id ||
                edge.node.handle === rule.rule_value ||
                edge.node.title === rule.rule_value
              );
            }
          } catch (e) {
            // Fallback for non-JSON rule_id
            matches = product.collections.edges.some(edge =>
              edge.node.id === rule.rule_id ||
              edge.node.handle === rule.rule_value ||
              edge.node.title === rule.rule_value
            );
          }
          break;
      }

      // If any rule matches, the configuration applies
      if (matches) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('[Storefront API] Error checking if config applies:', error);
    return false;
  }
}

// Helper function to fetch metafield value from Shopify
async function fetchMetafieldValue(shop, productHandle, namespace, key) {
  try {
    // Get session for this shop
    const session = await getShopSession(shop);
    if (!session) {
      console.error('[Storefront API] Cannot fetch metafield - no session available');
      return null;
    }

    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      query GetProductMetafield($handle: String!, $namespace: String!, $key: String!) {
        productByHandle(handle: $handle) {
          id
          metafield(namespace: $namespace, key: $key) {
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
          }
        }
      }
    `;

    const response = await client.request(query, {
      variables: {
        handle: productHandle,
        namespace: namespace,
        key: key
      }
    });

    const metafield = response.data?.productByHandle?.metafield;

    if (!metafield) {
      return null;
    }

    // Process value based on type
    switch (metafield.type) {
      case 'file_reference':
        // Check if it's an image or a file
        if (metafield.reference?.image) {
          return metafield.reference.image.url;
        } else if (metafield.reference?.url) {
          return metafield.reference.url;
        }
        return metafield.value;

      case 'list.file_reference':
        // Return array of image/file URLs
        if (metafield.references?.nodes && metafield.references.nodes.length > 0) {
          const urls = metafield.references.nodes.map(node => {
            if (node.image) {
              return node.image.url;
            } else if (node.url) {
              return node.url;
            }
            return null;
          }).filter(url => url !== null);
          console.log(`[Storefront API] List file URLs for ${namespace}.${key}:`, urls);
          return JSON.stringify(urls);
        }
        return metafield.value;

      case 'list.metaobject_reference':
        // Return array of structured metaobject data
        if (metafield.references?.nodes && metafield.references.nodes.length > 0) {
          const metaobjectArray = [];
          for (const node of metafield.references.nodes) {
            if (node.fields) {
              const metaobjectData = {};
              for (const field of node.fields) {
                // Process nested references (images, files)
                if (field.reference?.image) {
                  metaobjectData[field.key] = field.reference.image.url;
                } else if (field.reference?.url) {
                  metaobjectData[field.key] = field.reference.url;
                } else {
                  metaobjectData[field.key] = field.value;
                }
              }
              metaobjectArray.push(metaobjectData);
            }
          }
          console.log(`[Storefront API] List metaobject data for ${namespace}.${key}:`, metaobjectArray);
          return JSON.stringify(metaobjectArray);
        }
        return metafield.value;

      case 'metaobject_reference':
        // Return structured metaobject data
        if (metafield.reference?.fields) {
          const metaobjectData = {};
          for (const field of metafield.reference.fields) {
            // Process nested references (images, files)
            if (field.reference?.image) {
              metaobjectData[field.key] = field.reference.image.url;
            } else if (field.reference?.url) {
              metaobjectData[field.key] = field.reference.url;
            } else {
              metaobjectData[field.key] = field.value;
            }
          }
          console.log(`[Storefront API] Metaobject data for ${namespace}.${key}:`, metaobjectData);
          return JSON.stringify(metaobjectData);
        }
        return metafield.value;

      default:
        // For text and other types, return the value directly
        return metafield.value;
    }
  } catch (error) {
    console.error('[Storefront API] Error fetching metafield:', error);
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
    console.log("File upload request received");
    console.log("Has file:", !!req.file);

    if (!req.file) {
      console.error("No file in request");
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    const session = res.locals.shopify.session;

    console.log("Uploading file to Shopify:", req.file.originalname);

    // Upload file to Shopify
    const fileData = await uploadFileToShopify(
      session,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    console.log("File uploaded successfully:", fileData.shopifyFileId);

    res.status(200).json({
      success: true,
      file: fileData,
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.use(express.json());

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
    console.log(`Failed to process products/create: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
});

// Configuration routes
app.use("/api/configurations", configurationRoutes);

// Resource routes (vendors, collections, categories, products)
app.use("/api", resourceRoutes);

// Metafield definitions endpoint
app.get("/api/metafield-definitions", async (_req, res) => {
  try {
    const client = new shopify.api.clients.Graphql({
      session: res.locals.shopify.session,
    });

    const query = `
      query GetMetafieldDefinitions {
        metafieldDefinitions(first: 100, ownerType: PRODUCT) {
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
        }
      }
    `;

    const response = await client.request(query);
    const definitions = response.data.metafieldDefinitions.edges.map(
      (edge) => edge.node
    );

    res.status(200).json({
      definitions,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching metafield definitions:", error);
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
    console.error("Error fetching metaobject definition:", error);
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
    console.error("Error fetching metaobject:", error);
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
    console.error("Error creating/updating metaobject:", error);
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
