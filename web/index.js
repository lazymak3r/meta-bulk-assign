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

app.use("/api/*", shopify.validateAuthenticatedSession());

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

// Configure multer for file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max file size
  },
});

// File upload endpoint
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
