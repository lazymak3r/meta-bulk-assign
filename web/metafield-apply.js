import shopify from "./shopify.js";
import { throttledMutation, throttledQuery, sleep, processWithThrottling } from "./rate-limiter.js";

/**
 * Applies metafield configurations to a product
 * @param {Object} options
 * @param {boolean} options.mergeExistingLists - When true, reads existing list metafield values
 *   and merges new values into them instead of replacing. Use this when applying a single
 *   configuration that should coexist with values from other configurations.
 */
export async function applyMetafieldsToProduct(
  session,
  productId,
  metafieldConfigs,
  { mergeExistingLists = false } = {}
) {
  const client = new shopify.api.clients.Graphql({ session });

  // If mergeExistingLists, deep-clone configs so we don't mutate the caller's objects,
  // then fetch current values for list-type metafields and merge
  if (mergeExistingLists) {
    metafieldConfigs = metafieldConfigs.map(c => ({
      ...c,
      value: Array.isArray(c.value) ? [...c.value] : c.value,
    }));

    const listConfigs = metafieldConfigs.filter(c =>
      c.type === 'list.file_reference' || c.type === 'list.metaobject_reference'
    );

    if (listConfigs.length > 0) {
      const aliases = listConfigs.map((c, i) =>
        `_mf${i}: metafield(namespace: "${c.namespace}", key: "${c.key}") { value }`
      ).join("\n        ");

      const readQuery = `
        query ReadProductMetafields($id: ID!) {
          product(id: $id) {
            ${aliases}
          }
        }
      `;

      try {
        const readResp = await throttledQuery(client, readQuery, { id: productId });
        const product = readResp.data.product;

        if (product) {
          for (let i = 0; i < listConfigs.length; i++) {
            const existing = product[`_mf${i}`];
            if (existing && existing.value) {
              try {
                const existingValues = JSON.parse(existing.value);
                if (Array.isArray(existingValues) && Array.isArray(listConfigs[i].value)) {
                  const merged = [...new Set([...existingValues, ...listConfigs[i].value])];
                  listConfigs[i].value = merged;
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      } catch (err) {
        console.warn(`[MetafieldApply] Could not read existing metafields for merge: ${err.message}`);
        // Continue without merging — will still set the new values
      }
    }
  }

  // Build metafields input array
  const metafields = [];

  for (const config of metafieldConfigs) {
    // Skip if value is empty or undefined
    if (!config.value || config.value === '') {
      console.log(`Skipping metafield ${config.namespace}.${config.key} - empty value`);
      continue;
    }

    // For list.metaobject_reference, validate array of GIDs
    if (config.type === 'list.metaobject_reference') {
      if (!Array.isArray(config.value)) {
        console.log(`Skipping metafield ${config.namespace}.${config.key} - value is not an array`);
        continue;
      }

      // Validate each GID in the array
      const invalidGids = config.value.filter(gid => !String(gid).startsWith('gid://shopify/Metaobject/'));
      if (invalidGids.length > 0) {
        console.log(`Skipping metafield ${config.namespace}.${config.key} - invalid metaobject GIDs found`);
        continue;
      }

      const metafield = {
        namespace: config.namespace,
        key: config.key,
        value: JSON.stringify(config.value), // Stringify array for GraphQL
        type: config.type,
      };

      metafields.push(metafield);
      continue;
    }

    // For list.file_reference, validate array of file GIDs
    if (config.type === 'list.file_reference') {
      if (!Array.isArray(config.value)) {
        console.log(`Skipping metafield ${config.namespace}.${config.key} - value is not an array`);
        continue;
      }

      // Filter out empty values and validate GIDs
      const validFileGids = config.value.filter(gid => {
        const gidStr = String(gid);
        return gidStr && (gidStr.startsWith('gid://shopify/MediaImage/') || gidStr.startsWith('gid://shopify/GenericFile/'));
      });

      if (validFileGids.length === 0) {
        console.log(`Skipping metafield ${config.namespace}.${config.key} - no valid file GIDs`);
        continue;
      }

      const metafield = {
        namespace: config.namespace,
        key: config.key,
        value: JSON.stringify(validFileGids), // Stringify array for GraphQL
        type: config.type,
      };

      metafields.push(metafield);
      continue;
    }

    // For metaobject_reference, ensure value is a valid GID
    if (config.type === 'metaobject_reference') {
      const valueStr = String(config.value);
      if (!valueStr.startsWith('gid://shopify/Metaobject/')) {
        console.log(`Skipping metafield ${config.namespace}.${config.key} - invalid metaobject GID: ${valueStr}`);
        continue;
      }
    }

    const metafield = {
      namespace: config.namespace,
      key: config.key,
      value: String(config.value), // Ensure value is a string
      type: config.type,
    };

    // For file_reference (single), handle array values by taking the first GID
    if (config.type === 'file_reference' && Array.isArray(config.value)) {
      const firstGid = config.value.find(gid => {
        const g = String(gid);
        return g.startsWith('gid://shopify/MediaImage/') || g.startsWith('gid://shopify/GenericFile/');
      });
      if (!firstGid) {
        console.log(`Skipping metafield ${config.namespace}.${config.key} - no valid file GID in array`);
        continue;
      }
      metafield.value = String(firstGid);
      console.log(`[file_reference] Using first GID for ${config.namespace}.${config.key}: ${firstGid} (${config.value.length} total)`);
    }

    metafields.push(metafield);
  }

  const mutation = `
    mutation UpdateProductMetafields($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
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
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    // Use throttled mutation with automatic retry on throttle errors
    const response = await throttledMutation(client, mutation, {
      input: {
        id: productId,
        metafields: metafields,
      },
    });

    if (response.data.productUpdate.userErrors.length > 0) {
      throw new Error(
        `GraphQL errors: ${JSON.stringify(response.data.productUpdate.userErrors)}`
      );
    }

    return response.data.productUpdate.product;
  } catch (error) {
    console.error(`Failed to apply metafields to product ${productId}:`, error);
    throw error;
  }
}

/**
 * Applies vendor configuration to products in selected categories
 */
export async function bulkApplyVendorConfig(
  session,
  vendorName,
  vendorConfig,
  selectedCategories = null
) {
  if (!vendorConfig || !vendorConfig.metafield_configs) {
    throw new Error("No metafield configuration found for this vendor");
  }

  const metafieldConfigs =
    typeof vendorConfig.metafield_configs === "string"
      ? JSON.parse(vendorConfig.metafield_configs)
      : vendorConfig.metafield_configs;

  const client = new shopify.api.clients.Graphql({ session });

  // Fetch all products for this vendor with category information
  const query = `
    query GetProductsByVendor($query: String!, $first: Int!, $after: String) {
      products(first: $first, query: $query, after: $after) {
        edges {
          node {
            id
            category {
              name
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

  // Fetch all products with their categories
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

  // Filter products by selected categories if provided
  let filteredProducts = products;
  if (selectedCategories && selectedCategories.length > 0) {
    filteredProducts = products.filter((product) => {
      const categoryName = product.category?.name || "Uncategorized";
      return selectedCategories.includes(categoryName);
    });
  }

  const productIds = filteredProducts.map((p) => p.id);

  console.log(
    `Applying metafields to ${productIds.length} products (${
      selectedCategories
        ? `in categories: ${selectedCategories.join(", ")}`
        : "all categories"
    }) for vendor ${vendorName}`
  );

  // Apply metafields to each product with throttling
  const results = await processWithThrottling(
    productIds,
    async (productId) => {
      await applyMetafieldsToProduct(session, productId, metafieldConfigs);
    },
    {
      delayBetweenRequests: 100, // 100ms delay between products
      maxRetries: 5,
      onSuccess: (productId, index, total) => {
        console.log(`[MetafieldApply] Applied to product ${index + 1}/${total}`);
      },
      onError: (productId, error, index, total) => {
        console.error(`[MetafieldApply] Failed product ${index + 1}/${total}: ${error.message}`);
      },
    }
  );

  // Transform errors to match expected format
  results.errors = results.errors.map(e => ({
    productId: e.item,
    error: e.error,
  }));

  return results;
}