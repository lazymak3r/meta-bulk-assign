import { DeliveryMethod } from "@shopify/shopify-api";
import database from "./database.js";
import { applyMetafieldsToProduct } from "./metafield-apply.js";
import shopify from "./shopify.js";

/**
 * Webhook handler for PRODUCTS_CREATE
 * Automatically applies vendor warranty configuration when a new product is created
 */
async function handleProductCreate(topic, shop, body, webhookId) {
  try {
    const payload = JSON.parse(body);
    const productId = `gid://shopify/Product/${payload.id}`;
    const vendor = payload.vendor;

    console.log(`Product created webhook received for product ${productId}, vendor: ${vendor}`);

    // If no vendor, skip
    if (!vendor) {
      console.log("Product has no vendor, skipping warranty assignment");
      return;
    }

    // Get vendor configuration from database
    const vendorData = await database.getVendorByName(shop, vendor);

    if (!vendorData || !vendorData.has_config) {
      console.log(`No configuration found for vendor "${vendor}", skipping warranty assignment`);
      return;
    }

    // Parse metafield configs
    const metafieldConfigs = vendorData.metafield_configs
      ? typeof vendorData.metafield_configs === "string"
        ? JSON.parse(vendorData.metafield_configs)
        : vendorData.metafield_configs
      : null;

    if (!metafieldConfigs || metafieldConfigs.length === 0) {
      console.log(`No metafield configs for vendor "${vendor}", skipping`);
      return;
    }

    // Create a session for making API calls
    // We need to get an offline session for the shop to make API calls from webhooks
    const sessionId = shopify.api.session.getOfflineId(shop);
    const session = await shopify.config.sessionStorage.loadSession(sessionId);

    if (!session) {
      console.error(`No session found for shop ${shop}`);
      return;
    }

    // Apply metafields to the new product
    console.log(`Applying metafields to product ${productId}`);
    await applyMetafieldsToProduct(session, productId, metafieldConfigs);
    console.log(`Successfully applied metafields to product ${productId}`);
  } catch (error) {
    console.error("Error handling product create webhook:", error);
    // Don't throw error to prevent webhook retry loops
  }
}

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  PRODUCTS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: handleProductCreate,
  },
};