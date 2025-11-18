import database from "./database.js";
import shopify from "./shopify.js";
import { bulkApplyVendorConfig } from "./metafield-apply.js";
import * as metaobjectHandler from "./metaobject-handler.js";

/**
 * Fetches all unique vendors from Shopify products
 */
async function fetchVendorsFromShopify(session) {
  const client = new shopify.api.clients.Graphql({ session });

  const query = `
    query GetVendors {
      products(first: 250) {
        edges {
          node {
            vendor
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  let hasNextPage = true;
  let cursor = null;
  const vendors = new Map(); // Map to count products per vendor

  while (hasNextPage) {
    const queryWithCursor = cursor
      ? query.replace("first: 250", `first: 250, after: "${cursor}"`)
      : query;

    const response = await client.request(queryWithCursor);
    const { edges, pageInfo } = response.data.products;

    edges.forEach(({ node }) => {
      if (node.vendor) {
        vendors.set(node.vendor, (vendors.get(node.vendor) || 0) + 1);
      }
    });

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return vendors;
}

/**
 * Syncs vendors from Shopify to local database
 */
async function syncVendors(shop, session) {
  const shopifyVendors = await fetchVendorsFromShopify(session);

  for (const [vendorName, productCount] of shopifyVendors) {
    const vendor = await database.getOrCreateVendor(shop, vendorName);
    await database.updateVendorProductCount(shop, vendorName, productCount);
  }

  return shopifyVendors;
}

/**
 * GET /api/vendors
 * List all vendors with their configurations
 */
export async function getVendors(req, res) {
  try {
    const shop = res.locals.shopify.session.shop;
    const session = res.locals.shopify.session;

    // Sync vendors from Shopify
    await syncVendors(shop, session);

    // Get all vendors from database
    const vendors = await database.getAllVendors(shop);

    // Parse metafield_configs JSON for each vendor
    const vendorsWithConfigs = vendors.map((vendor) => ({
      ...vendor,
      metafield_configs: vendor.metafield_configs
        ? JSON.parse(vendor.metafield_configs)
        : null,
    }));

    res.status(200).json({
      vendors: vendorsWithConfigs,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching vendors:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /api/vendors/:name
 * Get a specific vendor by name
 */
export async function getVendorByName(req, res) {
  try {
    const shop = res.locals.shopify.session.shop;
    const vendorName = decodeURIComponent(req.params.name);

    const vendor = await database.getVendorByName(shop, vendorName);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        error: "Vendor not found",
      });
    }

    // Parse metafield_configs if exists
    if (vendor.metafield_configs) {
      vendor.metafield_configs = JSON.parse(vendor.metafield_configs);
    }

    res.status(200).json({
      vendor,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching vendor:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /api/vendors/:name/products
 * Get products for a specific vendor
 */
export async function getVendorProducts(req, res) {
  try {
    const session = res.locals.shopify.session;
    const vendorName = decodeURIComponent(req.params.name);
    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      query GetProductsByVendor($query: String!, $first: Int!, $after: String) {
        products(first: $first, query: $query, after: $after) {
          edges {
            node {
              id
              title
              vendor
              status
              category {
                name
              }
              featuredImage {
                url
              }
              metafields(first: 20) {
                edges {
                  node {
                    namespace
                    key
                    value
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

    let hasNextPage = true;
    let cursor = null;
    const products = [];

    while (hasNextPage) {
      const response = await client.request(query, {
        variables: {
          query: `vendor:'${vendorName}'`,
          first: 50,
          after: cursor,
        },
      });

      const { edges, pageInfo } = response.data.products;
      products.push(...edges.map((edge) => edge.node));

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
    }

    // Group products by category
    const categoriesMap = new Map();
    products.forEach((product) => {
      const categoryName = product.category?.name || "Uncategorized";
      if (!categoriesMap.has(categoryName)) {
        categoriesMap.set(categoryName, []);
      }
      categoriesMap.get(categoryName).push(product);
    });

    // Convert to array format
    const categories = Array.from(categoriesMap.entries()).map(
      ([name, products]) => ({
        name,
        products,
        count: products.length,
      })
    );

    // Sort categories by name, but put "Uncategorized" last
    categories.sort((a, b) => {
      if (a.name === "Uncategorized") return 1;
      if (b.name === "Uncategorized") return -1;
      return a.name.localeCompare(b.name);
    });

    res.status(200).json({
      categories,
      products, // Keep original products array for backward compatibility
      success: true,
    });
  } catch (error) {
    console.error("Error fetching vendor products:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/vendors/:name/config
 * Save vendor metafield configuration
 */
export async function saveVendorConfig(req, res) {
  try {
    const shop = res.locals.shopify.session.shop;
    const session = res.locals.shopify.session;
    const vendorName = decodeURIComponent(req.params.name);
    const { metafieldConfigs, warrantyFileId } = req.body;

    // Get or create vendor
    const vendor = await database.getOrCreateVendor(shop, vendorName);

    // Process metafield configs - create metaobjects if needed
    const processedConfigs = [];

    for (const config of metafieldConfigs) {
      const processedConfig = { ...config };

      // Check if this is a metaobject_reference with field values to create
      if (
        config.type === "metaobject_reference" &&
        config.metaobjectFieldValues &&
        typeof config.metaobjectFieldValues === "object" &&
        !Array.isArray(config.metaobjectFieldValues)
      ) {
        try {
          // Get the metaobject definition ID from the config
          const definitionId = config.metaobjectDefinitionId;

          if (!definitionId) {
            throw new Error(
              `Missing metaobject definition ID for field ${config.namespace}.${config.key}`
            );
          }

          // Fetch the metaobject definition
          const definition = await metaobjectHandler.getMetaobjectDefinition(
            session,
            definitionId
          );

          let metaobjectId;

          if (config.metaobjectId) {
            // Update existing metaobject
            metaobjectId = await metaobjectHandler.updateMetaobject(
              session,
              config.metaobjectId,
              config.metaobjectFieldValues,
              definition
            );
          } else {
            // Create new metaobject
            metaobjectId = await metaobjectHandler.createMetaobject(
              session,
              definition.type,
              config.metaobjectFieldValues,
              definition
            );
          }

          // Update the config with the metaobject GID
          processedConfig.value = metaobjectId;
          processedConfig.metaobjectId = metaobjectId;

          console.log(
            `Created/Updated metaobject for ${config.namespace}.${config.key}: ${metaobjectId}`
          );
        } catch (error) {
          console.error(
            `Error creating metaobject for ${config.namespace}.${config.key}:`,
            error
          );
          throw error;
        }
      }

      processedConfigs.push(processedConfig);
    }

    // Save configuration with processed metaobject references
    await database.saveVendorConfig(
      vendor.id,
      processedConfigs,
      warrantyFileId || null
    );

    res.status(200).json({
      success: true,
      message: "Vendor configuration saved successfully",
    });
  } catch (error) {
    console.error("Error saving vendor config:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * DELETE /api/vendors/:name/config
 * Delete vendor metafield configuration
 */
export async function deleteVendorConfig(req, res) {
  try {
    const shop = res.locals.shopify.session.shop;
    const vendorName = decodeURIComponent(req.params.name);

    const vendor = await database.getVendorByName(shop, vendorName);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        error: "Vendor not found",
      });
    }

    await database.deleteVendorConfig(vendor.id);

    res.status(200).json({
      success: true,
      message: "Vendor configuration deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting vendor config:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/vendors/:name/apply
 * Bulk apply vendor metafield configuration to selected categories
 */
export async function applyVendorConfig(req, res) {
  try {
    const shop = res.locals.shopify.session.shop;
    const session = res.locals.shopify.session;
    const vendorName = decodeURIComponent(req.params.name);
    const { selectedCategories } = req.body;

    // Get vendor configuration
    const vendor = await database.getVendorByName(shop, vendorName);

    if (!vendor) {
      return res.status(404).json({
        success: false,
        error: "Vendor not found",
      });
    }

    if (!vendor.has_config) {
      return res.status(400).json({
        success: false,
        error: "No configuration found for this vendor",
      });
    }

    if (!selectedCategories || selectedCategories.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No categories selected",
      });
    }

    // Apply configuration to products in selected categories
    const results = await bulkApplyVendorConfig(
      session,
      vendorName,
      vendor,
      selectedCategories
    );

    res.status(200).json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("Error applying vendor config:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}