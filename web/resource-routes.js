import { Router } from "express";
import shopify from "./shopify.js";
import { throttledQuery, sleep } from "./rate-limiter.js";

const router = Router();

/**
 * GET /api/resources
 * Combined endpoint: returns vendors, categories, products, collections,
 * and metafield definitions in a SINGLE response.
 * Runs Shopify API calls sequentially to avoid throttling.
 */
router.get("/resources", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    // ── 1. Fetch all products (extracts vendors + categories too) ──
    const products = [];
    const vendors = new Set();
    const categories = new Set();
    let hasNextPage = true;
    let cursor = null;

    const productsQuery = `
      query getAllProductData($cursor: String) {
        products(first: 250, after: $cursor) {
          edges {
            node {
              id
              title
              vendor
              category { name }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, productsQuery, { cursor });
      const data = response.data.products;

      for (const edge of data.edges) {
        const node = edge.node;
        products.push({ id: node.id, title: node.title });
        if (node.vendor) vendors.add(node.vendor);
        if (node.category?.name) categories.add(node.category.name);
      }

      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    // ── 2. Fetch all collections ──
    const collections = [];
    hasNextPage = true;
    cursor = null;

    const collectionsQuery = `
      query getCollections($cursor: String) {
        collections(first: 250, after: $cursor) {
          edges {
            node { id title }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, collectionsQuery, { cursor });
      const data = response.data.collections;

      for (const edge of data.edges) {
        collections.push({ id: edge.node.id, title: edge.node.title });
      }

      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    // ── 3. Fetch all metafield definitions ──
    const definitions = [];
    hasNextPage = true;
    cursor = null;

    const defsQuery = `
      query GetMetafieldDefinitions($cursor: String) {
        metafieldDefinitions(first: 250, after: $cursor, ownerType: PRODUCT) {
          edges {
            node {
              id name namespace key
              type { name }
              description
              validations { name value }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, defsQuery, { cursor });
      const data = response.data.metafieldDefinitions;

      for (const edge of data.edges) {
        definitions.push(edge.node);
      }

      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    // ── Return everything sorted ──
    res.json({
      products: products.sort((a, b) => a.title.localeCompare(b.title)),
      vendors: Array.from(vendors).sort(),
      categories: Array.from(categories).sort(),
      collections: collections.sort((a, b) => a.title.localeCompare(b.title)),
      definitions,
    });
  } catch (error) {
    console.error("Error fetching resources:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/products/vendors
 * Fetch unique vendors (uses shared product scan)
 */
router.get("/products/vendors", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const vendors = new Set();
    let hasNextPage = true;
    let cursor = null;

    const query = `
      query getVendors($cursor: String) {
        products(first: 250, after: $cursor) {
          edges { node { vendor } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, query, { cursor });
      const products = response.data.products;
      products.edges.forEach((edge) => {
        if (edge.node.vendor) vendors.add(edge.node.vendor);
      });
      hasNextPage = products.pageInfo.hasNextPage;
      cursor = products.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    res.json({ vendors: Array.from(vendors).sort() });
  } catch (error) {
    console.error("Error fetching vendors:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/collections
 */
router.get("/collections", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const collections = [];
    let hasNextPage = true;
    let cursor = null;

    const query = `
      query getCollections($cursor: String) {
        collections(first: 250, after: $cursor) {
          edges { node { id title } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, query, { cursor });
      const data = response.data.collections;
      data.edges.forEach((edge) => {
        collections.push({ id: edge.node.id, title: edge.node.title });
      });
      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    res.json({ collections: collections.sort((a, b) => a.title.localeCompare(b.title)) });
  } catch (error) {
    console.error("Error fetching collections:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/categories
 */
router.get("/categories", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const categories = new Set();
    let hasNextPage = true;
    let cursor = null;

    const query = `
      query getCategories($cursor: String) {
        products(first: 250, after: $cursor) {
          edges { node { category { name } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, query, { cursor });
      const products = response.data.products;
      products.edges.forEach((edge) => {
        if (edge.node.category?.name) categories.add(edge.node.category.name);
      });
      hasNextPage = products.pageInfo.hasNextPage;
      cursor = products.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    res.json({ categories: Array.from(categories).sort() });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/products
 */
router.get("/products", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const products = [];
    let hasNextPage = true;
    let cursor = null;

    const query = `
      query getProducts($cursor: String) {
        products(first: 250, after: $cursor) {
          edges { node { id title } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, query, { cursor });
      const data = response.data.products;
      data.edges.forEach((edge) => {
        products.push({ id: edge.node.id, title: edge.node.title });
      });
      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    res.json({ products: products.sort((a, b) => a.title.localeCompare(b.title)) });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/products/search
 */
router.get("/products/search", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });
    const { query: searchQuery } = req.query;

    if (!searchQuery) {
      return res.json({ products: [] });
    }

    const products = [];
    let hasNextPage = true;
    let cursor = null;

    const query = `
      query searchProducts($query: String!, $cursor: String) {
        products(first: 250, query: $query, after: $cursor) {
          edges {
            node { id title vendor productType category { name } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    while (hasNextPage) {
      const response = await throttledQuery(client, query, { query: searchQuery, cursor });
      const data = response.data.products;
      data.edges.forEach((edge) => {
        products.push({
          id: edge.node.id,
          title: edge.node.title,
          vendor: edge.node.vendor,
          productType: edge.node.productType,
          category: edge.node.category,
        });
      });
      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;
      if (hasNextPage) await sleep(100);
    }

    res.json({ products });
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
