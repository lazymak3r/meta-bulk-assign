import { Router } from "express";
import shopify from "./shopify.js";

const router = Router();

/**
 * GET /api/products/vendors
 * Fetch unique vendors from all products
 */
router.get("/products/vendors", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    // Fetch all vendors using pagination
    const vendors = new Set();
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query getVendors($cursor: String) {
          products(first: 250, after: $cursor) {
            edges {
              node {
                vendor
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;

      const response = await client.query({
        data: {
          query,
          variables: { cursor },
        },
      });

      const products = response.body.data.products;

      products.edges.forEach((edge) => {
        if (edge.node.vendor) {
          vendors.add(edge.node.vendor);
        }
      });

      hasNextPage = products.pageInfo.hasNextPage;
      if (hasNextPage && products.edges.length > 0) {
        cursor = products.edges[products.edges.length - 1].cursor;
      }
    }

    res.json({ vendors: Array.from(vendors).sort() });
  } catch (error) {
    console.error("Error fetching vendors:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/collections
 * Fetch all collections
 */
router.get("/collections", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const collections = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query getCollections($cursor: String) {
          collections(first: 250, after: $cursor) {
            edges {
              node {
                id
                title
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;

      const response = await client.query({
        data: {
          query,
          variables: { cursor },
        },
      });

      const collectionsData = response.body.data.collections;

      collectionsData.edges.forEach((edge) => {
        collections.push({
          id: edge.node.id,
          title: edge.node.title,
        });
      });

      hasNextPage = collectionsData.pageInfo.hasNextPage;
      if (hasNextPage && collectionsData.edges.length > 0) {
        cursor = collectionsData.edges[collectionsData.edges.length - 1].cursor;
      }
    }

    res.json({ collections: collections.sort((a, b) => a.title.localeCompare(b.title)) });
  } catch (error) {
    console.error("Error fetching collections:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/categories
 * Fetch Shopify product categories (taxonomy)
 */
router.get("/categories", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    // Fetch unique categories from products
    const categories = new Set();
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query getCategories($cursor: String) {
          products(first: 250, after: $cursor) {
            edges {
              node {
                category {
                  name
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;

      const response = await client.query({
        data: {
          query,
          variables: { cursor },
        },
      });

      const products = response.body.data.products;

      products.edges.forEach((edge) => {
        if (edge.node.category?.name) {
          categories.add(edge.node.category.name);
        }
      });

      hasNextPage = products.pageInfo.hasNextPage;
      if (hasNextPage && products.edges.length > 0) {
        cursor = products.edges[products.edges.length - 1].cursor;
      }
    }

    res.json({ categories: Array.from(categories).sort() });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/products
 * Fetch all products using cursor-based pagination
 */
router.get("/products", async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Graphql({ session });

    const products = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query getProducts($cursor: String) {
          products(first: 250, after: $cursor) {
            edges {
              node {
                id
                title
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;

      const response = await client.query({
        data: {
          query,
          variables: { cursor },
        },
      });

      const data = response.body.data.products;

      data.edges.forEach((edge) => {
        products.push({
          id: edge.node.id,
          title: edge.node.title,
        });
      });

      hasNextPage = data.pageInfo.hasNextPage;
      if (hasNextPage && data.edges.length > 0) {
        cursor = data.edges[data.edges.length - 1].cursor;
      }
    }

    res.json({ products: products.sort((a, b) => a.title.localeCompare(b.title)) });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/products/search
 * Search products by title (for product selector) with pagination
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

    while (hasNextPage) {
      const query = `
        query searchProducts($query: String!, $cursor: String) {
          products(first: 250, query: $query, after: $cursor) {
            edges {
              node {
                id
                title
                vendor
                productType
                category {
                  name
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;

      const response = await client.query({
        data: {
          query,
          variables: { query: searchQuery, cursor },
        },
      });

      const data = response.body.data.products;

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
      if (hasNextPage && data.edges.length > 0) {
        cursor = data.edges[data.edges.length - 1].cursor;
      }
    }

    res.json({ products });
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;