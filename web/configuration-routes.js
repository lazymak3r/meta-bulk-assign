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

const router = express.Router();

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
    const { id } = req.params;
    const configuration = await database.getConfigurationById(id);

    if (!configuration) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    const rules = await database.getConfigurationRules(id);

    res.json({
      ...configuration,
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
    const { name, metafieldConfigs, rules, showOnStorefront, storefrontPosition } = req.body;

    const existing = await database.getConfigurationById(id);
    if (!existing) {
      return res.status(404).json({ error: "Configuration not found" });
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

    // Update configuration with storefront settings
    await database.updateConfiguration(
      id,
      finalName,
      type,
      processedConfigs,
      showOnStorefront || false,
      storefrontPosition || 'after_price'
    );

    // Delete old rules and create new ones
    await database.deleteConfigurationRules(id);
    if (rules && rules.length > 0) {
      await database.bulkCreateRules(id, rules);
    }

    // Get updated configuration with rules
    const updated = await database.getConfigurationById(id);
    const configRules = await database.getConfigurationRules(id);

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
    const { id } = req.params;

    const existing = await database.getConfigurationById(id);
    if (!existing) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    await database.deleteConfiguration(id);

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

    const existing = await database.getConfigurationById(id);
    if (!existing) {
      return res.status(404).json({ error: "Configuration not found" });
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
    const matchingProducts = await previewMatchingProducts(client, rules || []);

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

    const configuration = await database.getConfigurationById(id);
    if (!configuration) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    const client = new shopify.api.clients.Graphql({ session });
    const matchingProducts = await findMatchingProducts(client, id);

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

    const configuration = await database.getConfigurationById(id);
    if (!configuration) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    const client = new shopify.api.clients.Graphql({ session });

    // Find matching products
    const matchingProducts = await findMatchingProducts(client, id);

    console.log(
      `[Configurations] Applying configuration ${id} to ${matchingProducts.length} products`
    );

    // Process metafield configs (create metaobjects if needed)
    const metafieldConfigs = await processMetafieldConfigs(
      session,
      configuration.metafield_configs
    );

    // Apply metafields to each product
    const results = {
      total: matchingProducts.length,
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (const product of matchingProducts) {
      try {
        await applyMetafieldsToProduct(
          session,
          product.id,
          metafieldConfigs
        );
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          productId: product.id,
          productTitle: product.title,
          error: error.message,
        });
      }
    }

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
