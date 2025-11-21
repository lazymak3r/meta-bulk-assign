import { DeliveryMethod } from "@shopify/shopify-api";
import database from "./database.js";
import { applyMetafieldsToProduct } from "./metafield-apply.js";
import { createOrUpdateMetaobject } from "./metaobject-handler.js";
import shopify from "./shopify.js";

/**
 * Check if a product matches configuration rules
 */
function productMatchesRules(product, rules) {
  if (!rules || rules.length === 0) {
    return true; // No rules means match all
  }

  // Build tree structure
  const ruleMap = {};
  rules.forEach(rule => {
    ruleMap[rule.id] = { ...rule, children: [] };
  });

  rules.forEach(rule => {
    if (rule.parent_id && ruleMap[rule.parent_id]) {
      ruleMap[rule.parent_id].children.push(ruleMap[rule.id]);
    }
  });

  const rootNodes = rules.filter(r => !r.parent_id).map(r => ruleMap[r.id]);

  // Evaluate rules recursively
  function matchesRule(rule) {
    let matches = false;

    switch (rule.rule_type) {
      case 'vendor':
        matches = product.vendor === rule.rule_value;
        break;
      case 'category':
        matches = product.product_type === rule.rule_value ||
                  (product.category && product.category.name === rule.rule_value);
        break;
      case 'collection':
        // Collections not available in webhook payload, skip for now
        matches = false;
        break;
      case 'product':
        matches = `gid://shopify/Product/${product.id}` === rule.rule_id;
        break;
      default:
        matches = false;
    }

    if (!matches) return false;

    // Check children
    if (!rule.children || rule.children.length === 0) {
      return true;
    }

    const firstChildOperator = rule.children[0].operator;
    if (firstChildOperator === 'AND') {
      return rule.children.every(child => matchesRule(child));
    } else {
      return rule.children.some(child => matchesRule(child));
    }
  }

  // Product matches if it satisfies ANY root rule (OR logic)
  return rootNodes.some(node => matchesRule(node));
}

/**
 * Helper function to get metaobject definition ID from metafield definition
 */
async function getMetaobjectDefinitionIdFromMetafield(session, metafieldDefinitionId) {
  const client = new shopify.api.clients.Graphql({ session });

  const query = `
    query GetMetafieldDefinition($id: ID!) {
      metafieldDefinition(id: $id) {
        id
        validations {
          name
          value
        }
      }
    }
  `;

  try {
    const response = await client.request(query, {
      variables: { id: metafieldDefinitionId }
    });

    const validations = response.data.metafieldDefinition?.validations || [];
    const metaobjectDefValidation = validations.find(v => v.name === "metaobject_definition_id");

    return metaobjectDefValidation?.value || null;
  } catch (error) {
    console.error("Error fetching metafield definition:", error);
    throw error;
  }
}

/**
 * Helper function to process metafield configs and create metaobjects if needed
 */
async function processMetafieldConfigs(session, metafieldConfigs) {
  const processed = [];

  for (const config of metafieldConfigs) {
    const processedConfig = { ...config };

    // If this is a metaobject_reference, create/update the metaobject
    if (config.type === "metaobject_reference") {
      // Check if value is an object (field values) or already a GID
      const isValueObject = typeof config.value === "object" && config.value !== null;
      const isValueGid = typeof config.value === "string" && config.value.startsWith("gid://shopify/Metaobject/");

      if (isValueObject && Object.keys(config.value).length > 0) {
        // Value contains field values - need to create/update metaobject
        try {
          // Get metaobject definition ID - either from config or fetch from metafield definition
          let metaobjectDefinitionId = config.metaobjectDefinitionId;

          if (!metaobjectDefinitionId && config.definitionId) {
            // For backwards compatibility - fetch from metafield definition
            console.log(`[Webhook] Fetching metaobject definition ID for ${config.namespace}.${config.key}`);
            metaobjectDefinitionId = await getMetaobjectDefinitionIdFromMetafield(
              session,
              config.definitionId
            );
          }

          if (!metaobjectDefinitionId) {
            console.warn(
              `[Webhook] Skipping metaobject_reference ${config.namespace}.${config.key} - no metaobject definition ID`
            );
            processed.push(processedConfig);
            continue;
          }

          const metaobject = await createOrUpdateMetaobject(
            session,
            metaobjectDefinitionId,
            config.value,
            config.metaobjectId || null // Will be null for new, GID for updates
          );

          processedConfig.metaobjectId = metaobject.id;
          processedConfig.value = metaobject.id;
        } catch (error) {
          console.error(
            `[Webhook] Failed to create/update metaobject for ${config.namespace}.${config.key}:`,
            error
          );
          throw error;
        }
      } else if (!isValueGid) {
        // Value is neither valid field values nor a valid GID
        console.warn(
          `[Webhook] Skipping metaobject_reference ${config.namespace}.${config.key} - invalid value`
        );
      }
      // If isValueGid is true, the value is already a GID, keep it as is
    }

    processed.push(processedConfig);
  }

  return processed;
}

/**
 * Webhook handler for PRODUCTS_CREATE
 * Automatically applies configurations to new products based on priority
 */
async function handleProductCreate(topic, shop, body, webhookId) {
  console.log("[Webhook] ========================================");
  console.log("[Webhook] PRODUCTS_CREATE handler called");
  console.log("[Webhook] Topic:", topic);
  console.log("[Webhook] Shop:", shop);
  console.log("[Webhook] Webhook ID:", webhookId);
  console.log("[Webhook] ========================================");

  try {
    const payload = JSON.parse(body);
    const productId = `gid://shopify/Product/${payload.id}`;

    console.log(`[Webhook] Product created: ${productId}`);

    // Get offline session for API calls
    const sessionId = shopify.api.session.getOfflineId(shop);
    const session = await shopify.config.sessionStorage.loadSession(sessionId);

    if (!session) {
      console.error(`[Webhook] No session found for shop ${shop}`);
      return;
    }

    // Get all configurations for this shop (ordered by priority DESC)
    const configurations = await database.getAllConfigurations(shop);

    if (!configurations || configurations.length === 0) {
      console.log('[Webhook] No configurations found, skipping');
      return;
    }

    console.log(`[Webhook] Found ${configurations.length} configurations, checking matches`);

    // Check each configuration by priority and apply if matches
    let appliedCount = 0;
    for (const config of configurations) {
      const rules = await database.getConfigurationRules(config.id);

      if (productMatchesRules(payload, rules)) {
        console.log(`[Webhook] Product matches configuration ${config.id} (${config.name || 'Unnamed'}), applying metafields`);

        try {
          // Process metafield configs (create metaobjects if needed)
          const metafieldConfigs = await processMetafieldConfigs(session, config.metafield_configs);

          await applyMetafieldsToProduct(session, productId, metafieldConfigs);
          appliedCount++;
          console.log(`[Webhook] Successfully applied configuration ${config.id}`);
        } catch (error) {
          console.error(`[Webhook] Failed to apply configuration ${config.id}:`, error.message);
        }
      }
    }

    if (appliedCount === 0) {
      console.log('[Webhook] Product did not match any configurations');
    } else {
      console.log(`[Webhook] Applied ${appliedCount} configuration(s) to product ${productId}`);
    }
  } catch (error) {
    console.error("[Webhook] Error handling product create:", error);
    // Don't throw error to prevent webhook retry loops
  }
}

/**
 * Webhook handler for PRODUCTS_UPDATE
 * Automatically updates metafields on products when they're updated
 */
async function handleProductUpdate(topic, shop, body, webhookId) {
  console.log("[Webhook] ========================================");
  console.log("[Webhook] PRODUCTS_UPDATE handler called");
  console.log("[Webhook] Topic:", topic);
  console.log("[Webhook] Shop:", shop);
  console.log("[Webhook] Webhook ID:", webhookId);
  console.log("[Webhook] ========================================");

  try {
    const payload = JSON.parse(body);
    const productId = `gid://shopify/Product/${payload.id}`;

    console.log(`[Webhook] Product updated: ${productId}`);

    // Get offline session for API calls
    const sessionId = shopify.api.session.getOfflineId(shop);
    const session = await shopify.config.sessionStorage.loadSession(sessionId);

    if (!session) {
      console.error(`[Webhook] No session found for shop ${shop}`);
      return;
    }

    // Get all configurations for this shop (ordered by priority DESC)
    const configurations = await database.getAllConfigurations(shop);

    if (!configurations || configurations.length === 0) {
      console.log('[Webhook] No configurations found, skipping');
      return;
    }

    console.log(`[Webhook] Found ${configurations.length} configurations, checking matches`);

    // Check each configuration by priority and apply if matches
    let appliedCount = 0;
    for (const config of configurations) {
      const rules = await database.getConfigurationRules(config.id);

      if (productMatchesRules(payload, rules)) {
        console.log(`[Webhook] Product matches configuration ${config.id} (${config.name || 'Unnamed'}), applying metafields`);

        try {
          // Process metafield configs (create metaobjects if needed)
          const metafieldConfigs = await processMetafieldConfigs(session, config.metafield_configs);

          await applyMetafieldsToProduct(session, productId, metafieldConfigs);
          appliedCount++;
          console.log(`[Webhook] Successfully applied configuration ${config.id}`);
        } catch (error) {
          console.error(`[Webhook] Failed to apply configuration ${config.id}:`, error.message);
        }
      }
    }

    if (appliedCount === 0) {
      console.log('[Webhook] Product did not match any configurations');
    } else {
      console.log(`[Webhook] Applied ${appliedCount} configuration(s) to product ${productId}`);
    }
  } catch (error) {
    console.error("[Webhook] Error handling product update:", error);
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
  PRODUCTS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: handleProductUpdate,
  },
};