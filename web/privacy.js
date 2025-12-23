import { DeliveryMethod } from "@shopify/shopify-api";
import database from "./database.js";

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  /**
   * Customers can request their data from a store owner. When this happens,
   * Shopify invokes this privacy webhook.
   *
   * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-data_request
   *
   * This app does NOT store any customer personal data. We only store:
   * - Shop domain (for multi-tenant isolation)
   * - Product metafield configurations (not customer-related)
   *
   * Therefore, we respond acknowledging the request but confirming no customer data is stored.
   */
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      console.log("[Privacy Webhook] CUSTOMERS_DATA_REQUEST received");
      console.log("[Privacy Webhook] Shop:", shop);
      console.log("[Privacy Webhook] Webhook ID:", webhookId);

      try {
        const payload = JSON.parse(body);
        const customerId = payload.customer?.id;
        const customerEmail = payload.customer?.email;

        console.log("[Privacy Webhook] Customer ID:", customerId);
        console.log("[Privacy Webhook] Customer Email:", customerEmail);

        // This app does not store any customer personal data.
        // We only store shop-level configurations for metafield assignments.
        // No action needed - Shopify will be informed that we have no customer data.

        console.log("[Privacy Webhook] CUSTOMERS_DATA_REQUEST completed - No customer data stored by this app");
      } catch (error) {
        console.error("[Privacy Webhook] Error processing CUSTOMERS_DATA_REQUEST:", error);
        // Don't throw - webhook should still return 200
      }
    },
  },

  /**
   * Store owners can request that data is deleted on behalf of a customer. When
   * this happens, Shopify invokes this privacy webhook.
   *
   * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-redact
   *
   * This app does NOT store any customer personal data, so no deletion is needed.
   */
  CUSTOMERS_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      console.log("[Privacy Webhook] CUSTOMERS_REDACT received");
      console.log("[Privacy Webhook] Shop:", shop);
      console.log("[Privacy Webhook] Webhook ID:", webhookId);

      try {
        const payload = JSON.parse(body);
        const customerId = payload.customer?.id;
        const customerEmail = payload.customer?.email;

        console.log("[Privacy Webhook] Customer ID:", customerId);
        console.log("[Privacy Webhook] Customer Email:", customerEmail);

        // This app does not store any customer personal data.
        // We only store shop-level configurations for metafield assignments.
        // No deletion needed.

        console.log("[Privacy Webhook] CUSTOMERS_REDACT completed - No customer data stored by this app");
      } catch (error) {
        console.error("[Privacy Webhook] Error processing CUSTOMERS_REDACT:", error);
        // Don't throw - webhook should still return 200
      }
    },
  },

  /**
   * 48 hours after a store owner uninstalls your app, Shopify invokes this
   * privacy webhook.
   *
   * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#shop-redact
   *
   * We MUST delete all shop data when this webhook is received.
   */
  SHOP_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (topic, shop, body, webhookId) => {
      console.log("[Privacy Webhook] SHOP_REDACT received");
      console.log("[Privacy Webhook] Shop:", shop);
      console.log("[Privacy Webhook] Webhook ID:", webhookId);

      try {
        const payload = JSON.parse(body);
        const shopId = payload.shop_id;
        const shopDomain = payload.shop_domain || shop;

        console.log("[Privacy Webhook] Shop ID:", shopId);
        console.log("[Privacy Webhook] Shop Domain:", shopDomain);

        // Delete all data for this shop from our database
        const deletedCount = await database.deleteShopData(shopDomain);

        console.log(`[Privacy Webhook] SHOP_REDACT completed - Deleted ${deletedCount} configurations for shop: ${shopDomain}`);
      } catch (error) {
        console.error("[Privacy Webhook] Error processing SHOP_REDACT:", error);
        // Don't throw - webhook should still return 200
        // But log the error for monitoring
      }
    },
  },
};
