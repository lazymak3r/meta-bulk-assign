/**
 * Storefront Config Sync
 *
 * This module syncs the displayType configuration to a shop metafield,
 * allowing the app embed to read the config directly from Liquid
 * without making an API call.
 */

import shopify from "./shopify.js";
import database from "./database.js";
import { throttledQuery, throttledMutation } from "./rate-limiter.js";

// Metafield namespace and key for storing storefront config
const STOREFRONT_CONFIG_NAMESPACE = "meta_bulk_assign";
const STOREFRONT_CONFIG_KEY = "storefront_display_config";

/**
 * Ensure the metafield definition exists with storefront access
 * This is required for the metafield to be readable from Liquid on the storefront
 */
async function ensureMetafieldDefinition(session) {
  const client = new shopify.api.clients.Graphql({ session });

  // First, check if the definition already exists
  const checkQuery = `
    query CheckMetafieldDefinition {
      metafieldDefinitions(
        first: 1,
        ownerType: SHOP,
        namespace: "${STOREFRONT_CONFIG_NAMESPACE}",
        key: "${STOREFRONT_CONFIG_KEY}"
      ) {
        edges {
          node {
            id
            access {
              storefront
            }
          }
        }
      }
    }
  `;

  try {
    const checkResponse = await throttledQuery(client, checkQuery);
    const existingDef = checkResponse.data?.metafieldDefinitions?.edges?.[0]?.node;

    if (existingDef) {
      // Definition exists - check if it has storefront access
      if (existingDef.access?.storefront === 'PUBLIC_READ') {
        console.log('[StorefrontConfigSync] Metafield definition already exists with storefront access');
        return true;
      }

      // Update the definition to add storefront access
      console.log('[StorefrontConfigSync] Updating metafield definition with storefront access');
      const updateMutation = `
        mutation UpdateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
          metafieldDefinitionUpdate(definition: $definition) {
            updatedDefinition {
              id
              access {
                storefront
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const updateResponse = await throttledMutation(client, updateMutation, {
        definition: {
          key: STOREFRONT_CONFIG_KEY,
          namespace: STOREFRONT_CONFIG_NAMESPACE,
          ownerType: "SHOP",
          access: {
            storefront: "PUBLIC_READ"
          }
        }
      });

      if (updateResponse.data?.metafieldDefinitionUpdate?.userErrors?.length > 0) {
        console.error('[StorefrontConfigSync] Error updating metafield definition:',
          updateResponse.data.metafieldDefinitionUpdate.userErrors);
        // Don't throw - the metafield might still work
      }

      return true;
    }

    // Create the definition
    console.log('[StorefrontConfigSync] Creating metafield definition with storefront access');
    const createMutation = `
      mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            access {
              storefront
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const createResponse = await throttledMutation(client, createMutation, {
      definition: {
        name: "Storefront Display Config",
        namespace: STOREFRONT_CONFIG_NAMESPACE,
        key: STOREFRONT_CONFIG_KEY,
        type: "json",
        ownerType: "SHOP",
        description: "Configuration for Meta Bulk Assign storefront display types",
        access: {
          storefront: "PUBLIC_READ"
        }
      }
    });

    if (createResponse.data?.metafieldDefinitionCreate?.userErrors?.length > 0) {
      console.error('[StorefrontConfigSync] Error creating metafield definition:',
        createResponse.data.metafieldDefinitionCreate.userErrors);
      // Don't throw - the metafield might still work without a definition
    } else {
      console.log('[StorefrontConfigSync] Metafield definition created successfully');
    }

    return true;
  } catch (error) {
    console.error('[StorefrontConfigSync] Error managing metafield definition:', error);
    // Don't throw - try to set the metafield anyway
    return false;
  }
}

/**
 * Sync all displayType configurations to shop metafield
 * Call this after any configuration is created, updated, or deleted
 */
export async function syncStorefrontConfig(session) {
  try {
    const shop = session.shop;

    // Ensure metafield definition exists with storefront access
    await ensureMetafieldDefinition(session);

    // Get all configurations for this shop
    const configs = await database.getAllConfigurations(shop);

    // Build displayType mapping: { "namespace.key": "displayType" }
    const displayTypeMap = {};

    for (const config of configs) {
      const metafieldConfigs = typeof config.metafield_configs === 'string'
        ? JSON.parse(config.metafield_configs)
        : config.metafield_configs;

      for (const mf of metafieldConfigs) {
        if (mf.displayType && mf.displayType !== '') {
          const key = `${mf.namespace}.${mf.key}`;
          // Only set if not already set (higher priority configs come first)
          if (!displayTypeMap[key]) {
            displayTypeMap[key] = mf.displayType;
          }
        }
      }
    }

    console.log(`[StorefrontConfigSync] Syncing config for shop ${shop}:`, displayTypeMap);

    // Get shop ID first
    const client = new shopify.api.clients.Graphql({ session });

    const shopQuery = `
      query {
        shop {
          id
        }
      }
    `;

    const shopResponse = await throttledQuery(client, shopQuery);
    const shopId = shopResponse.data?.shop?.id;

    if (!shopId) {
      throw new Error('Could not get shop ID');
    }

    // Save to shop metafield
    const mutation = `
      mutation SetShopMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await throttledMutation(client, mutation, {
      metafields: [
        {
          ownerId: shopId,
          namespace: STOREFRONT_CONFIG_NAMESPACE,
          key: STOREFRONT_CONFIG_KEY,
          type: "json",
          value: JSON.stringify(displayTypeMap)
        }
      ]
    });

    // Check for errors
    if (response.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('[StorefrontConfigSync] Failed to sync config:', response.data.metafieldsSet.userErrors);
      throw new Error(response.data.metafieldsSet.userErrors[0].message);
    }

    console.log('[StorefrontConfigSync] Config synced successfully');
    return displayTypeMap;
  } catch (error) {
    console.error('[StorefrontConfigSync] Error syncing config:', error);
    throw error;
  }
}

/**
 * Get the current storefront config from shop metafield
 */
export async function getStorefrontConfig(session) {
  try {
    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      query GetShopMetafield {
        shop {
          metafield(namespace: "${STOREFRONT_CONFIG_NAMESPACE}", key: "${STOREFRONT_CONFIG_KEY}") {
            value
          }
        }
      }
    `;

    const response = await throttledQuery(client, query);
    const value = response.data?.shop?.metafield?.value;

    return value ? JSON.parse(value) : {};
  } catch (error) {
    console.error('[StorefrontConfigSync] Error getting config:', error);
    return {};
  }
}
