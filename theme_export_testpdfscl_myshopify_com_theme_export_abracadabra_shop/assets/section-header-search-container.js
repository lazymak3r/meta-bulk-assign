// ---- Search logic ----
document.addEventListener("DOMContentLoaded", () => {
    let searchTimeout;

    const container = document.querySelector(".search-container");
    if (!container) return;

    const input = container.querySelector(".search-input");
    const dropdown = container.querySelector("#search-dropdown");
    const closeBtn = dropdown.querySelector("[data-search-close]");
    const catsSec = dropdown.querySelector("#categories-section");
    const prodsSec = dropdown.querySelector("#products-section");
    const noResSec = dropdown.querySelector("#search-no-results");

    // iOS Safari: prevent zoom on focus by temporarily locking viewport scale
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const originalViewportContent = viewportMeta
        ? viewportMeta.getAttribute("content")
        : "";
    const ua = navigator.userAgent || "";
    const isIOS =
        /iPhone|iPad|iPod/i.test(ua) ||
        (ua.indexOf("Mac") >= 0 && (navigator.maxTouchPoints || 0) > 1);
    function lockIOSZoom(lock) {
        if (!isIOS || !viewportMeta) return;
        try {
            if (lock) {
                let content =
                    originalViewportContent ||
                    "width=device-width, initial-scale=1";
                if (!/maximum-scale\s*=/.test(content))
                    content += ", maximum-scale=1";
                if (!/user-scalable\s*=/.test(content))
                    content += ", user-scalable=no";
                viewportMeta.setAttribute("content", content);
            } else {
                viewportMeta.setAttribute(
                    "content",
                    originalViewportContent ||
                        "width=device-width, initial-scale=1"
                );
            }
        } catch (_) {}
    }

    const MIN_CHARS = 3; // minimum chars to trigger search

    function eurosFromProduct(p) {
        if (typeof p.price_min === "number") return p.price_min / 100;
        if (typeof p.min_price === "number") return p.min_price / 100;
        if (typeof p.price === "number") return p.price;
        if (typeof p.price === "string") {
            const cleaned = p.price
                .replace(/[^\d.,]/g, "")
                .replace(/\.(?=\d{3}\b)/g, "")
                .replace(",", ".");
            const num = parseFloat(cleaned);
            return Number.isFinite(num) ? num : null;
        }
        return null;
    }
    const formatAbEuro = (amount) => {
        if (typeof window.formatAbEuro === "function") {
            return window.formatAbEuro(amount);
        }
        if (amount == null || isNaN(amount)) return "";
        const whole = new Intl.NumberFormat("de-DE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
        return `Ab ${whole},- €*`;
    };

    const openDropdown = () => {
        dropdown.style.display = "block";
    };
    const closeDropdown = () => {
        dropdown.style.display = "none";
    };

    // Mobile placeholder: keep desktop placeholder on >=768px, set to "suche" on mobile
    const defaultPlaceholder = input.getAttribute("placeholder") || "";
    const applyResponsivePlaceholder = () => {
        if (window.innerWidth < 768) {
            input.setAttribute("placeholder", "Suche");
        } else {
            input.setAttribute("placeholder", defaultPlaceholder);
        }
    };
    applyResponsivePlaceholder();
    window.addEventListener("resize", () => {
        // minimal debounce
        clearTimeout(window.__searchPhRaf);
        window.__searchPhRaf = setTimeout(applyResponsivePlaceholder, 100);
    });

    function handleSearchInput(query) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const q = (query || "").trim();

            if (!q.length) {
                closeDropdown();
                return;
            }

            if (q.length < MIN_CHARS) {
                catsSec.style.display = "none";
                prodsSec.style.display = "none";
                noResSec.style.display = "block";
                noResSec.innerHTML = `
          <div class="no-results-icon" aria-hidden="true">🔎</div>
          <p>Mindestens ${MIN_CHARS} Zeichen eingeben</p>
          <span>Versuchen Sie z.&nbsp;B. „Sofa“, „Stuhl“ oder „Tisch“.</span>
        `;
                openDropdown();
                return;
            }

            performSearch(q);
        }, 250);
    }

    function performSearch(query) {
        // Predictive-search endpoint with correct params
        const baseUrl =
            `/search/suggest.json` +
            `?resources[type]=product,collection` +
            `&resources[limit]=10` +
            `&resources[options][fields]=title,product_type,variants.title,tag,vendor,variants.sku` +
            `&q=`;

        const tryFetch = (q) =>
            fetch(baseUrl + encodeURIComponent(q)).then((r) => r.json());

        // small helper to render everything in one place
        const renderAll = (collections = [], products = []) => {
            if (collections.length) {
                catsSec.style.display = "block";
                renderCategories(collections);
            } else {
                catsSec.style.display = "none";
            }

            if (products.length) {
                prodsSec.style.display = "block";
                renderProducts(products);
            } else {
                prodsSec.style.display = "none";
            }

            const hasAnything = collections.length || products.length;
            if (!hasAnything) {
                noResSec.style.display = "block";
                noResSec.innerHTML = `
              <div class="no-results-icon" aria-hidden="true">🔍</div>
              <p>Keine Ergebnisse gefunden</p>
              <span>Versuchen Sie, nach „Sofa“, „Stuhl“ oder „Tisch“ zu suchen.</span>
            `;
            } else {
                noResSec.style.display = "none";
            }

            // Optional footer CTA to view full results page
            const footer = document.getElementById("search-footer");
            if (footer) {
                footer.innerHTML = `<a href="/search?q=${encodeURIComponent(
                    query
                )}">Alle Ergebnisse anzeigen ↩︎</a>`;
                footer.style.display = "block";
            }

            openDropdown();
        };

        // 1) try original query
        tryFetch(query)
            .then(async (data) => {
                let collections = data?.resources?.results?.collections ?? [];
                let products = data?.resources?.results?.products ?? [];

                // 2) fallback: drop the last token if nothing found (helps with color words)
                if (!collections.length && !products.length) {
                    const tokens = query.trim().split(/\s+/);
                    if (tokens.length > 1) {
                        const relaxed = tokens.slice(0, -1).join(" ");
                        const data2 = await tryFetch(relaxed);
                        collections =
                            data2?.resources?.results?.collections ?? [];
                        products = data2?.resources?.results?.products ?? [];
                    }
                }

                renderAll(collections, products);
            })
            .catch(() => closeDropdown());
    }

    function renderCategories(categories) {
        const target = document.getElementById("search-categories");
        target.innerHTML = categories
            .map(
                (c) =>
                    `<div class="category-suggestion" onclick="window.location.href='${c.url}'">${c.title}</div>`
            )
            .join("");
    }

    function renderProducts(products) {
        const target = document.getElementById("search-products");
        target.innerHTML = products
            .map((p) => {
                const amount = eurosFromProduct(p);
                const priceLabel = amount != null ? formatAbEuro(amount) : "";
                return `
        <div class="product-suggestion" onclick="window.location.href='${p.url}'">
          <img src="${p.image}" alt="${p.title}" class="product-suggestion-image">
          <div class="product-suggestion-info">
            <div class="product-suggestion-name">${p.title}</div>
            <div class="product-suggestion-price">${priceLabel}</div>
          </div>
        </div>
      `;
            })
            .join("");
    }

    // show on focus/typing
    input.addEventListener("focus", () => {
        if (input.value.trim().length >= 3) openDropdown();
        lockIOSZoom(true);
    });
    input.addEventListener("input", (e) => handleSearchInput(e.target.value));
    input.addEventListener("blur", () => lockIOSZoom(false));

    // click outside closes
    document.addEventListener("click", (e) => {
        if (!container.contains(e.target)) closeDropdown();
    });
    closeBtn &&
        closeBtn.addEventListener("click", () => {
            closeDropdown();
            input.blur();
        });

    // keep open while interacting inside dropdown (prevents blur race)
    dropdown.addEventListener("mousedown", (e) => e.preventDefault());

    // ESC closes
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeDropdown();
            input.blur();
        }
    });

    // Enter -> go to full search
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const q = input.value.trim();
            if (q) window.location.href = `/search?q=${encodeURIComponent(q)}`;
        }
    });

    function showDefaultSuggestions() {}
    // showDefaultSuggestions();
});
