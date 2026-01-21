import { useState, useEffect, useRef, useCallback } from "react";
import {
  LegacyCard,
  VerticalStack,
  Text,
  Spinner,
  HorizontalStack,
  Badge,
  ResourceList,
  ResourceItem,
  Button,
} from "@shopify/polaris";
import { useAuthenticatedFetch } from "../../hooks";
import "./ProductPreview.css";

/**
 * Preview products that match configuration rules
 */
export function ProductPreview({ rules, configurationId = null }) {
  const fetch = useAuthenticatedFetch();
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);

  // AbortController ref to cancel previous requests
  const abortControllerRef = useRef(null);

  const fetchPreview = useCallback(async () => {
    // Cancel any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!rules || rules.length === 0) {
      setCount(0);
      setProducts([]);
      return;
    }

    // Create a new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    setError(null);

    try {
      let response;

      if (configurationId) {
        // Fetch preview for saved configuration
        response = await fetch(`/api/configurations/${configurationId}/preview`, {
          signal: abortController.signal,
        });
      } else {
        // Fetch preview for unsaved rules
        response = await fetch("/api/configurations/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules }),
          signal: abortController.signal,
        });
      }

      // Check if request was aborted
      if (abortController.signal.aborted) {
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch product preview");
      }

      const data = await response.json();
      setCount(data.count);
      setProducts(data.products || []);
    } catch (err) {
      // Ignore abort errors - they're expected when canceling requests
      if (err.name === 'AbortError') {
        return;
      }
      console.error("Error fetching product preview:", err);
      setError(err.message);
      setCount(0);
      setProducts([]);
    } finally {
      // Only update loading state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, [fetch, rules, configurationId]);

  useEffect(() => {
    // Debounce the preview fetch
    const timeoutId = setTimeout(() => {
      fetchPreview();
    }, 500);

    return () => {
      clearTimeout(timeoutId);
      // Cancel any in-flight request when rules change or component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [rules, configurationId, fetchPreview]);

  return (
    <LegacyCard sectioned>
      <VerticalStack gap="4">
        <VerticalStack gap="2">
          <Text as="h2" variant="headingMd">
            Target Products
          </Text>
          <Text as="p" tone="subdued">
            Products that match your configuration rules
          </Text>
        </VerticalStack>

        {loading ? (
          <HorizontalStack align="center" blockAlign="center">
            <Spinner size="small" />
            <Text as="span">Loading products...</Text>
          </HorizontalStack>
        ) : error ? (
          <Text as="p" tone="critical">
            {error}
          </Text>
        ) : (
          <VerticalStack gap="3">
            <HorizontalStack align="space-between">
              <Text as="p" variant="headingSm">
                {count} product{count !== 1 ? "s" : ""} match
              </Text>
              <Button size="slim" onClick={fetchPreview}>
                Refresh
              </Button>
            </HorizontalStack>

            {count === 0 ? (
              <Text as="p" tone="subdued">
                No products match the current rules. Add or modify rules to target products.
              </Text>
            ) : (
              <VerticalStack gap="2">
                {products.length > 0 && (
                  <>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Showing first {products.length} products:
                    </Text>
                    <ResourceList
                      resourceName={{ singular: "product", plural: "products" }}
                      items={products}
                      renderItem={(product) => {
                        const { id, title, vendor, productType, category } = product;
                        return (
                          <ResourceItem id={id} onClick={() => {}}>
                            <VerticalStack gap="1">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                {title}
                              </Text>
                              <HorizontalStack gap="2">
                                {vendor && (
                                  <span className="product-preview-badge vendor">
                                    {vendor}
                                  </span>
                                )}

                                {productType && (
                                    <span className="product-preview-badge collection">
                                      {productType}
                                    </span>
                                )}
                                {category?.name && (
                                  <span className="product-preview-badge category">
                                    {category.name}
                                  </span>
                                )}
                              </HorizontalStack>
                            </VerticalStack>
                          </ResourceItem>
                        );
                      }}
                    />
                  </>
                )}
              </VerticalStack>
            )}
          </VerticalStack>
        )}
      </VerticalStack>
    </LegacyCard>
  );
}