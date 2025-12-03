let cartInfo = {};

const jsonHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
};

// target handles / hints; real IDs are resolved at runtime
const SECTION_HANDLES = [
    "header",
    "header-nav-links",
    "header-logo",
    "header-search-container",
    "header-wishlist-button",
    "header-cart-button",
    "header-account-button",
    "mega-menu",
];

const okJson = (r) => (r.ok ? r.json() : r.json().then(Promise.reject));

const EUR = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
});

// find actual section wrapper in DOM
function findSectionWrapper(hint) {
    const byId = document.getElementById(`shopify-section-${hint}`);
    if (byId) return byId;
    const byData =
        document.querySelector(`[data-section-id="${hint}"]`) ||
        document.querySelector(`[data-section="${hint}"]`) ||
        document.querySelector(`[data-section-type="${hint}"]`);
    if (byData) {
        const wrapper = byData.closest('[id^="shopify-section-"]');
        if (wrapper) return wrapper;
    }
    if (hint === "header-cart-button") {
        const badge =
            document.querySelector(".cart-badge") ||
            document.querySelector("[data-cart-badge]") ||
            document.querySelector("[data-cart-count]");
        if (badge) {
            const wrapper = badge.closest('[id^="shopify-section-"]');
            if (wrapper) return wrapper;
        }
    }
    return null;
}

function getSectionIds() {
    const ids = new Set();
    SECTION_HANDLES.forEach((hint) => {
        const el = findSectionWrapper(hint);
        if (el?.id) ids.add(el.id.replace("shopify-section-", ""));
    });
    return Array.from(ids);
}

// Build payload for /cart endpoints so Shopify returns rendered HTML for those sections
function buildSectionsPayload() {
    const sections = getSectionIds();
    return {
        sections,
        sections_url: window.location.pathname + window.location.search,
    };
}

// Swap returned HTML for each section id
function updateSections(sections) {
    if (sections) {
        Object.entries(sections).forEach(([id, html]) => {
            const el = document.getElementById(`shopify-section-${id}`);
            if (el && typeof html === "string") el.outerHTML = html;
        });
    }
    document.dispatchEvent(new Event("cart:refresh"));
    document.dispatchEvent(
        new CustomEvent("cart:updated", { detail: { sections } })
    );
    if (window?.initHeader) window.initHeader();
}

// Add a variant (absolute qty >=1)
const addItem = (variantId, qty) =>
    fetch("/cart/add.js", {
        method: "POST",
        headers: jsonHeaders,
        credentials: "same-origin",
        body: JSON.stringify({
            id: variantId,
            quantity: qty,
            ...buildSectionsPayload(),
        }),
    })
        .then(okJson)
        .then((data) => {
            if (data.sections) updateSections(data.sections); // keep header/badge in sync
            // IMPORTANT: always return the CART object from here
            return fetch("/cart.js", { credentials: "same-origin" }).then(
                okJson
            );
        });

// Change by line-item key (absolute qty >=0)
const changeByKey = (lineKey, qty) =>
    fetch("/cart/change.js", {
        method: "POST",
        headers: jsonHeaders,
        credentials: "same-origin",
        body: JSON.stringify({
            id: lineKey,
            quantity: qty,
            ...buildSectionsPayload(),
        }),
    }).then(okJson);

function findLineItem(cart, variantId) {
    return (
        (cart.items || []).find((li) => String(li.id) === String(variantId)) ||
        null
    );
}

const setQty = (cart, variantId, qty) => {
    qty = Math.max(0, parseInt(qty || 0, 10));
    const li = findLineItem(cart, variantId);
    if (!li) {
        if (qty === 0) return Promise.resolve(cart);
        return addItem(variantId, qty);
    }
    return changeByKey(li.key, qty);
};

function updateCartInfo() {
    fetch("/cart.js")
        .then(okJson)
        .then((cart) => {
            cartInfo = cart;
            console.log("cartInfo", cartInfo);
            updateCartBadge(cartInfo.item_count);
            updateCartBanner();
            try {
                syncCardCartIcons(cartInfo);
            } catch (_) {}
        });
}

function updateCartBadge(count) {
    const badge = document.querySelector("#cartCount, .cart-badge");
    if (!badge) return;

    badge.textContent = count > 0 ? String(count) : "";

    if (count > 0) {
        badge.classList.remove("hidden");
        badge.style.opacity = "1";
        badge.style.transform = "scale(1)";
    } else {
        badge.classList.add("hidden");
        badge.style.opacity = "0";
        badge.style.transform = "scale(0)";
    }
}

function checkCartBannerVisibility() {
    if (!cartInfo.item_count) {
        hideCartBanner();
    } else {
        showCartBanner();
    }
}

function addToCart(product, quantity, onAdded = null, onRestore = null) {
    if (onAdded) {
        onAdded();
    }
    const variantId = getDefaultVariantId(product);
    if (!variantId) {
        if (onRestore) onRestore();
        return;
    }
    fetch("/cart/add.js", {
        method: "POST",
        headers: jsonHeaders,
        credentials: "same-origin",
        body: JSON.stringify({
            id: variantId,
            quantity,
            ...buildSectionsPayload(),
        }),
    })
        .then(okJson)
        .then((data) => {
            if (data.sections) updateSections(data.sections);
            showCartBanner();
            updateCartInfo();
            showMiniCartPopover();
            if (onRestore) onRestore();
        });
}

function getDefaultVariantId(product) {
    return product?.variants?.[0]?.id || null;
}

function showCartBanner() {
    const banner = document.getElementById("cart-banner");
    if (banner) {
        banner.style.display = "block";
        setTimeout(() => {
            banner.classList.add("show");
        }, 100);
        localStorage.setItem("cart-banner-visible", "true");
        setupCartBannerClickHandlers();
    }
}

function hideCartBanner() {
    const banner = document.getElementById("cart-banner");
    if (banner) {
        banner.classList.remove("show");
        setTimeout(() => {
            banner.style.display = "none";
        }, 400);
        localStorage.setItem("cart-banner-visible", "false");
    }
}

function expandCartBanner() {
    const collapsed = document.getElementById("cart-banner-collapsed");
    const expanded = document.getElementById("cart-banner-expanded");
    if (collapsed && expanded) {
        collapsed.style.display = "none";
        expanded.style.display = "block";
        localStorage.setItem("cart-banner-expanded", "true");
    }
}

function collapseCartBanner() {
    const collapsed = document.getElementById("cart-banner-collapsed");
    const expanded = document.getElementById("cart-banner-expanded");
    if (collapsed && expanded) {
        expanded.style.display = "none";
        collapsed.style.display = "flex";
        localStorage.setItem("cart-banner-expanded", "false");
    }
}

function updateCartBanner() {
    updateCartBadge(cartInfo.item_count);
    checkCartBannerVisibility();
    const cartBannerCount = document.getElementById("cart-banner-count");
    if (cartBannerCount) {
        cartBannerCount.textContent = cartInfo.item_count;
    }
    const cartTotalElements = document.querySelectorAll(
        "#cart-total, #cart-total-expanded"
    );
    cartTotalElements.forEach((element) => {
        if (element) {
            element.textContent = EUR.format(cartInfo.total_price / 100);
        }
    });
    updateCartItemsList();
    updateMiniCartPopover();
}

// Toggle "in-cart" class on icon buttons inside product cards based on current cart items
function syncCardCartIcons(cart) {
    try {
        const items = (cart && cart.items) || [];
        const variantIds = new Set(items.map((li) => String(li.id)));
        document.querySelectorAll(".icon-add-to-cart").forEach((btn) => {
            const host =
                btn.closest("article[data-variant-id]") ||
                btn.closest("[data-variant-id]");
            const vid = host && host.getAttribute("data-variant-id");
            const inCart = vid && variantIds.has(String(vid));
            btn.classList.toggle("in-cart", !!inCart);
        });
    } catch (_) {}
}

function updateCartItemsList() {
    const cartItemsContainer = document.getElementById("cart-banner-items");
    if (!cartItemsContainer || !cartInfo.items) return;
    cartItemsContainer.innerHTML = cartInfo.items
        .map(
            (item, index) => `
    <div class="cart-item" data-item-id="${index}">
      <img src="${item.featured_image?.url}" alt="${
                item.title
            }" class="cart-item-image">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.title}</div>
        <div class="cart-item-price">${EUR.format(item.price / 100)}</div>
        <div class="cart-item-controls">
          <div class="quantity-controls">
            ${
                item.quantity === 1
                    ? `<button class="remove-item" onclick="removeCartItem(${index})" title="Remove item">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </button>`
                    : `<button class="qty-btn qty-minus" onclick="updateCartItemQuantity(${index}, -1)" title="Decrease quantity">−</button>`
            }
            <span class="qty-display">${item.quantity}</span>
            <button class="qty-btn qty-plus" onclick="updateCartItemQuantity(${index}, 1)">+</button>
          </div>
        </div>
      </div>
    </div>
  `
        )
        .join("");
}

function updateMiniCartPopover() {
    const itemsWrap = document.getElementById("miniCartItems");
    const totalEl = document.getElementById("miniCartTotal");
    if (!itemsWrap) return;

    const items = cartInfo.items || [];

    itemsWrap.innerHTML = items
        .map((item) => {
            const img = item.featured_image?.url || item.image;
            const linePrice =
                (item.line_price ?? item.price * item.quantity) / 100;
            const variant =
                item.variant_title && item.variant_title !== "Default Title"
                    ? item.variant_title
                    : "";
            return `\n<div class="mc-item">\n  <img class="mc-thumb" src="${img}" alt="${
                item.product_title || item.title
            }">\n  <div class="mc-info">\n    <div class="mc-title">${
                item.product_title || item.title
            }</div>\n    ${
                variant ? `<div class=\"mc-meta\">${variant}</div>` : ""
            }\n    <div class=\"mc-meta\">${
                item.quantity
            }x</div>\n  </div>\n  <div class="mc-price">${(
                window.formatEuro ||
                ((v) => `${Math.round(Number(v)).toLocaleString("de-DE")},- €*`)
            )(linePrice)}</div>\n</div>`;
        })
        .join("");

    if (totalEl) {
        const value = (
            window.formatEuro ||
            ((v) =>
                `${Math.round(Number(v) / 100).toLocaleString("de-DE")},- €*`)
        )(cartInfo.total_price);
        totalEl.textContent = value;
    }
}

// Mini cart popover show/hide
let miniCartTimeout = null;
let isUserScrolling = false;
let scrollTimeout = null;

function showMiniCartPopover(autoHideMs = 4000) {
    const popover = document.getElementById("miniCartPopover");
    if (!popover) return;

    // Clear any existing timeout
    if (miniCartTimeout) {
        clearTimeout(miniCartTimeout);
        miniCartTimeout = null;
    }

    // Show the popover
    popover.classList.add("is-open");
    popover.setAttribute("aria-hidden", "false");

    // Auto-hide after delay (only if user is not scrolling)
    if (autoHideMs > 0) {
        miniCartTimeout = setTimeout(() => {
            if (!isUserScrolling) {
                hideMiniCartPopover();
            }
        }, autoHideMs);
    }
}

function hideMiniCartPopover() {
    const popover = document.getElementById("miniCartPopover");
    if (!popover) return;

    popover.classList.remove("is-open");
    popover.setAttribute("aria-hidden", "true");

    if (miniCartTimeout) {
        clearTimeout(miniCartTimeout);
        miniCartTimeout = null;
    }
}

// Make functions globally available
window.showMiniCartPopover = showMiniCartPopover;
window.hideMiniCartPopover = hideMiniCartPopover;

// Add scroll detection for mobile
function setupScrollDetection() {
    const popover = document.getElementById("miniCartPopover");
    if (!popover) return;

    const itemsContainer = popover.querySelector(".mc-items");
    if (!itemsContainer) return;

    itemsContainer.addEventListener(
        "scroll",
        () => {
            isUserScrolling = true;

            // Clear any existing scroll timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // Reset scrolling flag after user stops scrolling for 1 second
            scrollTimeout = setTimeout(() => {
                isUserScrolling = false;
            }, 1000);
        },
        { passive: true }
    );
}

// Initialize scroll detection when DOM is ready
document.addEventListener("DOMContentLoaded", setupScrollDetection);

// Add click-outside-to-close functionality
function setupClickOutsideToClose() {
    document.addEventListener("click", (e) => {
        const popover = document.getElementById("miniCartPopover");
        if (!popover || !popover.classList.contains("is-open")) return;

        const cartButton = document.querySelector(
            ".cart-popover a, .cart-popover button"
        );

        // Check if click is outside the popover and not on the cart button
        if (!popover.contains(e.target) && !cartButton?.contains(e.target)) {
            hideMiniCartPopover();
        }
    });
}

// Initialize click-outside detection
document.addEventListener("DOMContentLoaded", setupClickOutsideToClose);

// Listen for cart updates from cart-core.js and update mini cart without showing it
document.addEventListener("cart:updated", () => {
    // Fetch fresh cart data and update mini cart content only
    fetch("/cart.js")
        .then(okJson)
        .then((cart) => {
            cartInfo = cart;
            updateCartBadge(cartInfo.item_count);
            updateMiniCartPopover(); // Update content without showing
        })
        .catch((err) => console.error("Failed to update mini cart:", err));
});

// Keep mini-cart open while hovering icon or popover (robust against gaps)
function bindMiniCartHover() {
    const wrapper = document.querySelector(".cart-popover");
    const popover = document.getElementById("miniCartPopover");
    if (!wrapper || !popover) return;

    let hoverCloseTimer = null;
    const openNow = () => {
        if (hoverCloseTimer) {
            clearTimeout(hoverCloseTimer);
            hoverCloseTimer = null;
        }
        popover.classList.add("is-open");
        popover.setAttribute("aria-hidden", "false");
    };
    const scheduleClose = () => {
        if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = setTimeout(() => {
            popover.classList.remove("is-open");
            popover.setAttribute("aria-hidden", "true");
        }, 120);
    };

    // Pointer events on both wrapper and popover
    ["mouseenter", "pointerenter"].forEach((evt) => {
        wrapper.addEventListener(evt, openNow);
        popover.addEventListener(evt, openNow);
    });
    ["mouseleave", "pointerleave"].forEach((evt) => {
        wrapper.addEventListener(evt, scheduleClose);
        popover.addEventListener(evt, scheduleClose);
    });
}

document.addEventListener("DOMContentLoaded", bindMiniCartHover);
document.addEventListener("cart:refresh", bindMiniCartHover);

function initCartBanner() {
    const isVisible = localStorage.getItem("cart-banner-visible") === "true";
    const isExpanded = localStorage.getItem("cart-banner-expanded") === "true";
    if (isVisible && cartInfo.item_count > 0) {
        showCartBanner();
        if (isExpanded) {
            expandCartBanner();
        } else {
            collapseCartBanner();
        }
    }
    setupCartBannerClickHandlers();
}

function setupCartBannerClickHandlers() {
    const collapsedBanner = document.getElementById("cart-banner-collapsed");
    const expandedBanner = document.getElementById("cart-banner-expanded");
    if (collapsedBanner) {
        collapsedBanner.addEventListener("click", function (e) {
            if (
                e.target.closest(".checkout-btn") ||
                e.target.closest(".expand-btn")
            ) {
                return;
            }
            expandCartBanner();
        });
        collapsedBanner.style.cursor = "pointer";
    }
    if (expandedBanner) {
        const bannerHeader = expandedBanner.querySelector(
            ".cart-banner-header"
        );
        if (bannerHeader) {
            bannerHeader.addEventListener("click", function (e) {
                if (e.target.closest(".collapse-btn")) {
                    return;
                }
                collapseCartBanner();
            });
            bannerHeader.style.cursor = "pointer";
        }
    }
}

async function clearCart() {
    const response = await fetch("/cart/clear.js", {
        method: "POST",
        headers: jsonHeaders,
        credentials: "same-origin",
        body: JSON.stringify({ ...buildSectionsPayload() }),
    });

    const data = await okJson(response).catch(() => ({})); // <- use okJson on the Response
    if (data.sections) updateSections(data.sections);
    await updateCartInfo();
    hideCartBanner();
}

function updateCartItemQuantity(itemIndex, change) {
    const item = cartInfo.items?.[itemIndex];
    if (!item) return;

    const nextQty = Math.max(0, (item.quantity || 0) + change);

    // Prefer the line-item key; fallback to 1-based line index if key missing
    const payload = item.key
        ? { id: item.key, quantity: nextQty, ...buildSectionsPayload() }
        : { line: itemIndex + 1, quantity: nextQty, ...buildSectionsPayload() };

    fetch("/cart/change.js", {
        method: "POST",
        headers: jsonHeaders,
        credentials: "same-origin",
        body: JSON.stringify(payload),
    })
        .then(okJson)
        .then((cart) => {
            if (cart.sections) updateSections(cart.sections);
            cartInfo = cart;
            checkCartBannerVisibility();
            updateCartBanner();
            try {
                syncCardCartIcons(cartInfo);
            } catch (_) {}
        });
}

function removeCartItem(itemIndex) {
    const product = cartInfo.items[itemIndex];
    if (!product) return;
    updateCartItemQuantity(itemIndex, -product.quantity);
}

window.addEventListener("load", () => {
    initCartBanner();
    updateCartInfo();
});

// ---- Global handlers for icon add-to-cart and favorite button focus management ----
// Blur any focused control inside a given root; helps avoid zoom/focus jumps on iOS
function blurInside(root) {
    try {
        const activeEl = document.activeElement;
        if (!activeEl || !root || !root.contains(activeEl)) return;
        if (typeof activeEl.blur === "function") activeEl.blur();
    } catch (_) {}
}

// Add one item when clicking small cart icon on cards/sliders
document.addEventListener(
    "click",
    (e) => {
        const btn = e.target.closest(".icon-add-to-cart");
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const card =
            btn.closest("article[data-product-id][data-variant-id]") ||
            btn.closest("[data-variant-id]");
        if (!card) return;

        const variantId = card.getAttribute("data-variant-id");
        if (!variantId) return;

        blurInside(card);

        // Fetch current cart, then increment quantity for this variant
        fetch("/cart.js", { credentials: "same-origin" })
            .then(okJson)
            .then((cart) =>
                setQty(
                    cart,
                    variantId,
                    (cart.items || []).reduce(
                        (n, li) =>
                            n +
                            (String(li.id) === String(variantId)
                                ? li.quantity || 0
                                : 0),
                        0
                    ) + 1
                )
            )
            .then((cart) => {
                if (cart.sections) updateSections(cart.sections);
                updateCartInfo();
                try {
                    window.showMiniCartPopover && window.showMiniCartPopover();
                } catch (_) {}
            })
            .catch((err) => console.error("ATC failed", err));
    },
    true
);

// Reduce focus stickiness on iOS for both buttons
document.addEventListener(
    "pointerdown",
    (e) => {
        const ctl = e.target.closest(".icon-add-to-cart, .favorite-btn");
        if (!ctl) return;
        const card =
            ctl.closest("article[data-product-id][data-variant-id]") ||
            ctl.closest("article[data-product-id]");
        if (card) blurInside(card);
    },
    true
);

// Additional blur on favorite click to avoid focus/hover artifacts on desktop
document.addEventListener(
    "click",
    (e) => {
        const fav = e.target.closest(".favorite-btn");
        if (!fav) return;
        const card = fav.closest("article[data-product-id]");
        if (!card) return;
        blurInside(card);
        setTimeout(() => blurInside(card), 0);
    },
    true
);
