/**
 * Product Matcher - Evaluates AND/OR rule trees to find matching products
 *
 * Logic:
 * - Horizontal (siblings at same level) = OR: Product matches if it satisfies ANY sibling
 * - Vertical (parent-child) = AND: Product must satisfy parent AND all children
 */

import database from "./database.js";

/**
 * Fetch all products from Shopify with specified fields
 */
async function fetchAllProducts(graphqlClient) {
  const allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query GetProducts($cursor: String) {
        products(first: 250, after: $cursor) {
          edges {
            node {
              id
              title
              vendor
              productType
              tags
              collections(first: 250) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
              category {
                id
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

    const response = await graphqlClient.query({
      data: {
        query,
        variables: { cursor },
      },
    });

    const { edges, pageInfo } = response.body.data.products;

    for (const edge of edges) {
      allProducts.push(edge.node);
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
  }

  return allProducts;
}

/**
 * Check if a product matches a single rule
 */
function matchesRule(product, rule) {
  // Support both camelCase (frontend) and snake_case (database)
  const ruleType = rule.rule_type || rule.ruleType;
  const ruleValue = rule.rule_value || rule.ruleValue;
  const ruleId = rule.rule_id || rule.ruleId;

  // Skip rules without values
  if (!ruleValue && !ruleId) {
    return false;
  }

  switch (ruleType) {
    case 'vendor':
      return product.vendor === ruleValue;

    case 'category':
      if (ruleId) {
        // Match by Shopify category GID
        return product.category?.id === ruleId;
      }
      // Match by category name
      return product.category?.name === ruleValue;

    case 'collection':
      if (ruleId) {
        // Match by collection GID
        return product.collections.edges.some(
          edge => edge.node.id === ruleId
        );
      }
      // Match by collection title
      return product.collections.edges.some(
        edge => edge.node.title === ruleValue
      );

    case 'product':
      // Match by product GID (can be single ID or JSON array of IDs for multiselect)
      if (!ruleId) return false;

      try {
        // Try parsing as JSON array (multiselect)
        const productIds = JSON.parse(ruleId);
        if (Array.isArray(productIds)) {
          return productIds.includes(product.id);
        }
      } catch {
        // Not JSON, treat as single ID
      }

      // Fallback to single ID comparison
      return product.id === ruleId;

    default:
      return false;
  }
}

/**
 * Build a tree structure from flat rules array
 */
function buildRuleTree(rules) {
  if (!rules || rules.length === 0) return [];

  // Group rules by level
  const rulesByLevel = {};
  const ruleMap = {};

  rules.forEach(rule => {
    if (!rulesByLevel[rule.level]) {
      rulesByLevel[rule.level] = [];
    }
    rulesByLevel[rule.level].push(rule);
    ruleMap[rule.id] = { ...rule, children: [] };
  });

  // Build parent-child relationships (support both camelCase and snake_case)
  rules.forEach(rule => {
    const parentId = rule.parent_id || rule.parentId;
    if (parentId && ruleMap[parentId]) {
      ruleMap[parentId].children.push(ruleMap[rule.id]);
    }
  });

  // Return root nodes (no parent)
  return rules.filter(r => !r.parent_id && !r.parentId).map(r => ruleMap[r.id]);
}

/**
 * Evaluate a rule node and its children recursively
 * Returns true if product matches this node's logic
 */
function evaluateRuleNode(product, node) {
  // Check if product matches this node
  const matchesThisRule = matchesRule(product, node);

  if (!matchesThisRule) {
    return false;
  }

  // If no children, just return the match result
  if (!node.children || node.children.length === 0) {
    return true;
  }

  // Group children by operator (though all children should have the same operator at the same level)
  // Evaluate children based on their operator
  const firstChildOperator = node.children[0].operator;

  if (firstChildOperator === 'AND') {
    // ALL children must match (AND logic)
    return node.children.every(child => evaluateRuleNode(product, child));
  } else {
    // ANY child must match (OR logic)
    return node.children.some(child => evaluateRuleNode(product, child));
  }
}

/**
 * Evaluate the entire rule tree for a product
 * Root level nodes are OR'd together (product matches if it matches ANY root node)
 */
function evaluateRuleTree(product, ruleTree) {
  if (!ruleTree || ruleTree.length === 0) {
    // No rules means match all products
    return true;
  }

  // Product matches if it satisfies ANY of the root-level rules
  return ruleTree.some(rootNode => evaluateRuleNode(product, rootNode));
}

/**
 * Find all products that match a configuration
 */
export async function findMatchingProducts(graphqlClient, configurationId) {
  // Get configuration rules
  const rules = await database.getConfigurationRules(configurationId);

  // Build tree from rules
  const ruleTree = buildRuleTree(rules);

  // Fetch all products
  const allProducts = await fetchAllProducts(graphqlClient);

  // Filter products that match the rule tree
  const matchingProducts = allProducts.filter(product =>
    evaluateRuleTree(product, ruleTree)
  );

  return matchingProducts;
}

/**
 * Find matching products for a preview (before saving configuration)
 * Takes rules array directly instead of configuration ID
 */
export async function previewMatchingProducts(graphqlClient, rules) {
  // Build tree from rules
  const ruleTree = buildRuleTree(rules);

  // Fetch all products
  const allProducts = await fetchAllProducts(graphqlClient);

  // Filter products that match the rule tree
  const matchingProducts = allProducts.filter(product =>
    evaluateRuleTree(product, ruleTree)
  );

  return matchingProducts;
}

/**
 * Determine configuration type based on rules
 */
export function determineConfigurationType(rules) {
  if (!rules || rules.length === 0) {
    return 'combined';
  }

  const ruleTypes = new Set(rules.map(r => r.rule_type || r.ruleType));

  if (ruleTypes.size === 1) {
    const type = Array.from(ruleTypes)[0];
    return type === 'product' ? 'product' : `${type}`;
  }

  return 'combined';
}

/**
 * Generate auto-name for configuration based on rules
 */
export function generateConfigurationName(rules) {
  if (!rules || rules.length === 0) {
    return 'Unnamed Configuration';
  }

  // Get root level rules (level = 0)
  const rootRules = rules.filter(r => r.level === 0);

  if (rootRules.length === 0) {
    return 'Unnamed Configuration';
  }

  if (rootRules.length === 1) {
    const rule = rootRules[0];
    const ruleType = rule.rule_type || rule.ruleType;
    const ruleValue = rule.rule_value || rule.ruleValue;
    const typeLabel = ruleType.charAt(0).toUpperCase() + ruleType.slice(1);
    return `${typeLabel}: ${ruleValue}`;
  }

  // Multiple root rules
  const type = determineConfigurationType(rules);
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  return `${typeLabel} Configuration`;
}

export default {
  findMatchingProducts,
  previewMatchingProducts,
  determineConfigurationType,
  generateConfigurationName,
};
