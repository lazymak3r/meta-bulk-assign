import crypto from "crypto";

export function validateAppProxySignature(query, apiSecret) {
  if (!query || !apiSecret) {
    console.error("[App Proxy Auth] Missing query or apiSecret");
    return false;
  }

  const { signature, ...params } = query;

  if (!signature) {
    console.error("[App Proxy Auth] No signature in query parameters");
    return false;
  }

  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      if (Array.isArray(value)) {
        return value.map((v) => `${key}=${v}`).join("");
      }
      return `${key}=${value}`;
    })
    .join("");

  const calculatedSignature = crypto
    .createHmac("sha256", apiSecret)
    .update(sortedParams)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(calculatedSignature, "hex")
    );
  } catch (error) {
    console.error("[App Proxy Auth] Signature comparison failed:", error.message);
    return false;
  }
}

export function appProxyAuthMiddleware(apiSecret) {
  return (req, res, next) => {
    if (process.env.NODE_ENV === "development" && process.env.SKIP_APP_PROXY_AUTH === "true") {
      console.warn("[App Proxy Auth] Skipping validation in development mode");
      return next();
    }

    const isValid = validateAppProxySignature(req.query, apiSecret);

    if (!isValid) {
      console.error("[App Proxy Auth] Invalid signature for request:", {
        shop: req.query.shop,
        path: req.path,
        hasSignature: !!req.query.signature,
      });
      return res.status(401).json({ error: "Unauthorized - Invalid signature" });
    }

    next();
  };
}
