import shopify from "./shopify.js";

/**
 * Applies metafield configurations to a product
 */
export async function applyMetafieldsToProduct(
  session,
  productId,
  metafieldConfigs
) {
  const client = new shopify.api.clients.Graphql({ session });

  // Build metafields input array
  const metafields = [];

  for (const config of metafieldConfigs) {
    // Skip if value is empty or undefined
    if (!config.value || config.value === '') {
      console.log(`Skipping metafield ${config.namespace}.${config.key} - empty value`);
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

    // Log for debugging file references
    if (config.type === 'file_reference') {
      console.log(`Applying file_reference metafield:`, {
        namespace: config.namespace,
        key: config.key,
        value: config.value,
        type: config.type
      });
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
    const response = await client.request(mutation, {
      variables: {
        input: {
          id: productId,
          metafields: metafields,
        },
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

  // Apply metafields to each product
  const results = {
    total: productIds.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  for (const productId of productIds) {
    try {
      await applyMetafieldsToProduct(session, productId, metafieldConfigs);
      results.successful++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        productId,
        error: error.message,
      });
    }
  }

  return results;
}