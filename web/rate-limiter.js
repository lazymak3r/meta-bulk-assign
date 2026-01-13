/**
 * Rate Limiter - Handles Shopify API rate limiting with exponential backoff
 *
 * Shopify GraphQL API uses a leaky bucket algorithm with:
 * - 1000 points per second leak rate
 * - 2000 point maximum bucket size
 * - Complex queries consume more points
 */

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is a throttle/rate limit error
 */
export function isThrottleError(error) {
  if (!error) return false;

  const message = error.message?.toLowerCase() || '';
  const response = error.response;

  // Check for common throttle indicators
  if (message.includes('throttled')) return true;
  if (message.includes('rate limit')) return true;
  if (message.includes('too many requests')) return true;
  if (response?.status === 429) return true;

  // Check for GraphQL throttle extensions
  if (error.extensions?.code === 'THROTTLED') return true;

  // Check response body for throttle errors
  if (response?.body?.errors) {
    const errors = response.body.errors;
    if (Array.isArray(errors)) {
      return errors.some(e =>
        e.extensions?.code === 'THROTTLED' ||
        e.message?.toLowerCase().includes('throttled')
      );
    }
  }

  return false;
}

/**
 * Execute a function with exponential backoff retry on throttle errors
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 5)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffMultiplier - Multiplier for each retry (default: 2)
 * @returns {Promise} - Result of the function
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 5,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isThrottleError(error) || attempt === maxRetries) {
        throw error;
      }

      console.log(
        `[RateLimiter] Throttled, attempt ${attempt + 1}/${maxRetries + 1}. ` +
        `Retrying in ${delay}ms...`
      );

      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Execute GraphQL requests with throttling between calls
 * Useful for batch operations to avoid hitting rate limits
 *
 * @param {Array} items - Items to process
 * @param {Function} processor - Async function to process each item
 * @param {Object} options - Configuration options
 * @param {number} options.delayBetweenRequests - Delay between requests in ms (default: 100)
 * @param {number} options.maxRetries - Max retries per request (default: 5)
 * @param {Function} options.onSuccess - Callback on successful processing
 * @param {Function} options.onError - Callback on failed processing
 * @returns {Promise<Object>} - Results with successful and failed counts
 */
export async function processWithThrottling(items, processor, options = {}) {
  const {
    delayBetweenRequests = 100,
    maxRetries = 5,
    onSuccess,
    onError,
  } = options;

  const results = {
    total: items.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    try {
      await withRetry(() => processor(item), { maxRetries });
      results.successful++;

      if (onSuccess) {
        onSuccess(item, i, items.length);
      }
    } catch (error) {
      results.failed++;
      results.errors.push({
        item,
        error: error.message,
      });

      if (onError) {
        onError(item, error, i, items.length);
      }
    }

    // Add delay between requests to avoid hitting rate limits
    if (i < items.length - 1) {
      await sleep(delayBetweenRequests);
    }
  }

  return results;
}

/**
 * Execute a paginated GraphQL query with automatic retry on throttle
 *
 * @param {Object} client - Shopify GraphQL client
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @param {Object} options - Retry options
 * @returns {Promise} - Query response
 */
export async function throttledQuery(client, query, variables = {}, options = {}) {
  return withRetry(
    async () => {
      // Support both .query() and .request() methods
      if (typeof client.query === 'function') {
        return client.query({
          data: {
            query,
            variables,
          },
        });
      } else if (typeof client.request === 'function') {
        return client.request(query, { variables });
      }
      throw new Error('GraphQL client must have query() or request() method');
    },
    options
  );
}

/**
 * Execute a GraphQL mutation with automatic retry on throttle
 *
 * @param {Object} client - Shopify GraphQL client
 * @param {string} mutation - GraphQL mutation string
 * @param {Object} variables - Mutation variables
 * @param {Object} options - Retry options
 * @returns {Promise} - Mutation response
 */
export async function throttledMutation(client, mutation, variables = {}, options = {}) {
  return withRetry(
    async () => {
      if (typeof client.request === 'function') {
        return client.request(mutation, { variables });
      } else if (typeof client.query === 'function') {
        return client.query({
          data: {
            query: mutation,
            variables,
          },
        });
      }
      throw new Error('GraphQL client must have query() or request() method');
    },
    options
  );
}

export default {
  sleep,
  isThrottleError,
  withRetry,
  processWithThrottling,
  throttledQuery,
  throttledMutation,
};
