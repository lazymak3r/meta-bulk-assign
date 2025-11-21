import { useAppBridge } from "@shopify/app-bridge-react";
import { useMemo } from "react";

/**
 * A hook that returns an authenticated fetch function.
 * For embedded apps, the session token is automatically handled by Shopify App Bridge.
 * The backend will validate the session from the request.
 *
 * @returns {Function} fetch function
 */
export function useAuthenticatedFetch() {
  const app = useAppBridge();

  // Create fetch function that's stable across renders
  const authenticatedFetch = useMemo(() => {
    return async (uri, options = {}) => {
      // For embedded apps, just make the request
      // The app bridge and backend handle authentication
      const response = await fetch(uri, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        credentials: "include", // Important for session cookies
      });

      // Check for reauthorization requirement
      if (
        response.headers.get("X-Shopify-API-Request-Failure-Reauthorize") === "1"
      ) {
        const authUrlHeader =
          response.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ||
          `/api/auth`;

        // Redirect to reauthorization URL
        window.top.location.href = authUrlHeader.startsWith("/")
          ? `https://${window.location.host}${authUrlHeader}`
          : authUrlHeader;
      }

      return response;
    };
  }, [app]);

  return authenticatedFetch;
}