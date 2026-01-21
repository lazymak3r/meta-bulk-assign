import express from "express";
import shopify from "./shopify.js";
import database from "./database.js";
import {
  findMatchingProducts,
  previewMatchingProducts,
  determineConfigurationType,
  generateConfigurationName,
} from "./product-matcher.js";
import { applyMetafieldsToProduct } from "./metafield-apply.js";
import { createOrUpdateMetaobject } from "./metaobject-handler.js";
import { syncStorefrontConfig } from "./storefront-config-sync.js";
import { processWithThrottling, sleep } from "./rate-limiter.js";

const router = express.Router();

async function verifyShopOwnership(configId, shopDomain) {
  const configuration = await database.getConfigurationById(configId);

  if (!configuration) {
    return { valid: false, error: "Configuration not found", status: 404 };
  }

  if (configuration.shop !== shopDomain) {
    console.warn(
      `[Security] Shop ${shopDomain} attempted to access configuration ${configId} owned by ${configuration.shop}`
    );
    return { valid: false, error: "Access denied", status: 403 };
  }

  return { valid: true, configuration };
}

/**
 * GET /api/configurations
 * Get all configurations for the shop
 */
router.get("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const configurations = await database.getAllConfigurations(session.shop);

    // Add rule count to each configuration
    const configurationsWithRules = await Promise.all(
      configurations.map(async (config) => {
        const rules = await database.getConfigurationRules(config.id);
        return {
          ...config,
          ruleCount: rules.length,
        };
      })
    );

    res.json(configurationsWithRules);
  } catch (error) {
    console.error("[Configurations] Error fetching configurations:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/configurations/:id
 * Get a single configuration with its rules
 */
router.get("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { id } = req.params;

    // Verify shop ownership
    const ownership = await verifyShopOwnership(id, session.shop);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }

    const rules = await database.getConfigurationRules(id);

    res.json({
      ...ownership.configuration,
      rules,
    });
  } catch (error) {
    console.error("[Configurations] Error fetching configuration:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/configurations
 * Create a new configuration with rules
 */
router.post("/", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { name, metafieldConfigs, rules, priority } = req.body;

    if (!metafieldConfigs || metafieldConfigs.length === 0) {
      return res
        .status(400)
        .json({ error: "Metafield configurations are required" });
    }

    // Process metaobject fields if present
    const processedConfigs = await processMetafieldConfigs(
      session,
      metafieldConfigs
    );

    // Determine configuration type based on rules
    const type = determineConfigurationType(rules || []);

    // Generate name if not provided
    const finalName = name || generateConfigurationName(rules || []);

    // Create configuration
    const configuration = await database.createConfiguration(
      session.shop,
      finalName,
      type,
      processedConfigs,
      priority || 0
    );

    // Create rules
    if (rules && rules.length > 0) {
      await database.bulkCreateRules(configuration.id, rules);
    }

    // Get the created configuration with rules
    const configRules = await database.getConfigurationRules(configuration.id);

    // Sync storefront config to shop metafield (for instant display)
    try {
      await syncStorefrontConfig(session);
    } catch (syncError) {
      console.error("[Configurations] Error syncing storefront config:", syncError);
      // Don't fail the request if sync fails
    }

    res.status(201).json({
      ...configuration,
      rules: configRules,
    });
  } catch (error) {
    console.error("[Configurations] Error creating configuration:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/configurations/priorities
 * Update priorities for multiple configurations
 * NOTE: This must come BEFORE /:id route to avoid route conflicts
 */
router.put("/priorities", async (req, res) => {
  try {
    const { priorities } = req.body;

    if (!Array.isArray(priorities)) {
      return res.status(400).json({ error: "Priorities must be an array" });
    }

    await database.updateAllPriorities(priorities);

    res.json({ success: true, message: "Priorities updated" });
  } catch (error) {
    console.error("[Configurations] Error updating priorities:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/configurations/:id
 * Update a configuration
 */
router.put("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { id } = req.params;
    const { name, metafieldConfigs, rules } = req.body;

    // Verify shop ownership
    const ownership = await verifyShopOwnership(id, session.shop);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }

    // Process metaobject fields if present
    const processedConfigs = await processMetafieldConfigs(
      session,
      metafieldConfigs
    );

    // Determine configuration type based on rules
    const type = determineConfigurationType(rules || []);

    // Generate name if not provided
    const finalName = name || generateConfigurationName(rules || []);

    // Update configuration
    await database.updateConfiguration(
      id,
      finalName,
      type,
      processedConfigs
    );

    // Delete old rules and create new ones
    await database.deleteConfigurationRules(id);
    if (rules && rules.length > 0) {
      await database.bulkCreateRules(id, rules);
    }

    // Get updated configuration with rules
    const updated = await database.getConfigurationById(id);
    const configRules = await database.getConfigurationRules(id);

    // Sync storefront config to shop metafield (for instant display)
    try {
      await syncStorefrontConfig(session);
    } catch (syncError) {
      console.error("[Configurations] Error syncing storefront config:", syncError);
      // Don't fail the request if sync fails
    }

    res.json({
      ...updated,
      rules: configRules,
    });
  } catch (error) {
    console.error("[Configurations] Error updating configuration:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/configurations/:id
 * Delete a configuration
 */
router.delete("/:id", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { id } = req.params;

    // Verify shop ownership
    const ownership = await verifyShopOwnership(id, session.shop);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }

    await database.deleteConfiguration(id);

    // Sync storefront config to shop metafield (for instant display)
    try {
      await syncStorefrontConfig(session);
    } catch (syncError) {
      console.error("[Configurations] Error syncing storefront config:", syncError);
      // Don't fail the request if sync fails
    }

    res.json({ success: true, message: "Configuration deleted" });
  } catch (error) {
    console.error("[Configurations] Error deleting configuration:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/configurations/:id/duplicate
 * Duplicate a configuration
 */
router.post("/:id/duplicate", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { id } = req.params;

    // Verify shop ownership
    const ownership = await verifyShopOwnership(id, session.shop);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }

    const duplicated = await database.duplicateConfiguration(
      id,
      session.shop
    );

    const rules = await database.getConfigurationRules(duplicated.id);

    res.status(201).json({
      ...duplicated,
      rules,
    });
  } catch (error) {
    console.error("[Configurations] Error duplicating configuration:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/configurations/preview
 * Preview products that match given rules (before saving)
 */
router.post("/preview", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { rules } = req.body;

    const client = new shopify.api.clients.Graphql({ session });
    const matchingProducts = await previewMatchingProducts(client, rules || [], session.shop);

    res.json({
      count: matchingProducts.length,
      products: matchingProducts.slice(0, 10), // Return first 10 for preview
    });
  } catch (error) {
    console.error("[Configurations] Error previewing products:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/configurations/:id/preview
 * Get products that match a saved configuration
 */
router.get("/:id/preview", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { id } = req.params;

    // Verify shop ownership
    const ownership = await verifyShopOwnership(id, session.shop);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }

    const client = new shopify.api.clients.Graphql({ session });
    const matchingProducts = await findMatchingProducts(client, id, session.shop);

    res.json({
      count: matchingProducts.length,
      products: matchingProducts.slice(0, 10), // Return first 10 for preview
    });
  } catch (error) {
    console.error("[Configurations] Error previewing products:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/configurations/:id/apply
 * Apply configuration to all matching products
 */
router.post("/:id/apply", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { id } = req.params;

    // Verify shop ownership
    const ownership = await verifyShopOwnership(id, session.shop);
    if (!ownership.valid) {
      return res.status(ownership.status).json({ error: ownership.error });
    }

    const configuration = ownership.configuration;
    const client = new shopify.api.clients.Graphql({ session });

    const matchingProducts = await findMatchingProducts(client, id, session.shop);

    console.log(
      `[Configurations] Applying configuration ${id} to ${matchingProducts.length} products`
    );

    // Process metafield configs (create metaobjects if needed)
    const metafieldConfigs = await processMetafieldConfigs(
      session,
      configuration.metafield_configs
    );

    // Apply metafields to each product with throttling
    const results = await processWithThrottling(
      matchingProducts,
      async (product) => {
        await applyMetafieldsToProduct(session, product.id, metafieldConfigs);
      },
      {
        delayBetweenRequests: 100, // 100ms delay between products
        maxRetries: 5,
        onSuccess: (product, index, total) => {
          console.log(
            `[Configurations] Applied to product ${index + 1}/${total}: ${product.title}`
          );
        },
        onError: (product, error, index, total) => {
          console.error(
            `[Configurations] Failed product ${index + 1}/${total} (${product.title}): ${error.message}`
          );
        },
      }
    );

    // Transform errors to include product details
    results.errors = results.errors.map((e) => ({
      productId: e.item.id,
      productTitle: e.item.title,
      error: e.error,
    }));

    res.json(results);
  } catch (error) {
    console.error("[Configurations] Error applying configuration:", error);
    res.status(500).json({ error: error.message });
  }
});

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

    // Handle list.metaobject_reference - create multiple metaobjects
    if (config.type === "list.metaobject_reference") {
      // Value should be an array
      const isValueArray = Array.isArray(config.value);

      if (isValueArray && config.value.length > 0) {
        // Check if values are already GIDs (from saved config) or field values (from new config)
        const isGidArray = config.value.every(v =>
          typeof v === 'string' && v.startsWith('gid://shopify/Metaobject/')
        );

        if (isGidArray) {
          // Values are already GIDs - use them as-is
          console.log(`Using existing metaobject GIDs for ${config.namespace}.${config.key}`);
          processedConfig.value = config.value;
          processedConfig.metaobjectIds = config.value;
        } else {
          // Values are field objects - need to create metaobjects
          try {
            // Get metaobject definition ID
            let metaobjectDefinitionId = config.metaobjectDefinitionId;

            if (!metaobjectDefinitionId && config.definitionId) {
              console.log(`Fetching metaobject definition ID for ${config.namespace}.${config.key}`);
              metaobjectDefinitionId = await getMetaobjectDefinitionIdFromMetafield(
                session,
                config.definitionId
              );
            }

            if (!metaobjectDefinitionId) {
              console.warn(
                `Skipping list.metaobject_reference ${config.namespace}.${config.key} - no metaobject definition ID`
              );
              processed.push(processedConfig);
              continue;
            }

            // Create a metaobject for each entry in the array
            const metaobjectGids = [];
            for (let i = 0; i < config.value.length; i++) {
              const entryValue = config.value[i];

              // Skip empty objects
              if (typeof entryValue !== "object" || Object.keys(entryValue).length === 0) {
                continue;
              }

              const metaobject = await createOrUpdateMetaobject(
                session,
                metaobjectDefinitionId,
                entryValue,
                null // Always create new metaobjects for list entries
              );

              metaobjectGids.push(metaobject.id);
            }

            // Store array of GIDs as the value
            processedConfig.value = metaobjectGids;
            processedConfig.metaobjectIds = metaobjectGids;

            console.log(`Created ${metaobjectGids.length} metaobjects for ${config.namespace}.${config.key}`);
          } catch (error) {
            console.error(
              `Failed to create metaobjects for list ${config.namespace}.${config.key}:`,
              error
            );
            throw error;
          }
        }
      } else {
        console.warn(
          `Skipping list.metaobject_reference ${config.namespace}.${config.key} - value is not an array or is empty`
        );
      }
    }
    // Handle single metaobject_reference
    else if (config.type === "metaobject_reference") {
      // Check if value is an object (field values) or already a GID
      const isValueObject = typeof config.value === "object" && config.value !== null && !Array.isArray(config.value);
      const isValueGid = typeof config.value === "string" && config.value.startsWith("gid://shopify/Metaobject/");

      if (isValueObject && Object.keys(config.value).length > 0) {
        // Value contains field values - need to create/update metaobject
        try {
          // Get metaobject definition ID - either from config or fetch from metafield definition
          let metaobjectDefinitionId = config.metaobjectDefinitionId;

          if (!metaobjectDefinitionId && config.definitionId) {
            // For backwards compatibility - fetch from metafield definition
            console.log(`Fetching metaobject definition ID for ${config.namespace}.${config.key}`);
            metaobjectDefinitionId = await getMetaobjectDefinitionIdFromMetafield(
              session,
              config.definitionId
            );
          }

          if (!metaobjectDefinitionId) {
            console.warn(
              `Skipping metaobject_reference ${config.namespace}.${config.key} - no metaobject definition ID`
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
            `Failed to create/update metaobject for ${config.namespace}.${config.key}:`,
            error
          );
          throw error;
        }
      } else if (!isValueGid) {
        // Value is neither valid field values nor a valid GID
        console.warn(
          `Skipping metaobject_reference ${config.namespace}.${config.key} - invalid value`
        );
      }
      // If isValueGid is true, the value is already a GID, keep it as is
    }

    processed.push(processedConfig);
  }

  return processed;
}

export default router;
