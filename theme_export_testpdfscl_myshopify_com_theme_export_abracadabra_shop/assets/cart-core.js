/* assets/cart-core.js */
(() => {
    if (window.ShopCart) return; // singleton guard

    const H = {
        "Content-Type": "application/json",
        Accept: "application/json",
    };
    const sectionHints = new Set();

    function findSectionWrapper(hint) {
        const byId = document.getElementById("shopify-section-" + hint);
        if (byId) return byId;
        const byData =
            document.querySelector('[data-section-id="' + hint + '"]') ||
            document.querySelector('[data-section="' + hint + '"]') ||
            document.querySelector('[data-section-type="' + hint + '"]');
        if (byData) return byData.closest('[id^="shopify-section-"]');
        if (hint === "header-cart-button") {
            const badge = document.querySelector(
                "#cartCount, .cart-badge, [data-cart-count]"
            );
            if (badge) return badge.closest('[id^="shopify-section-"]');
        }
        return null;
    }

    function sectionIds() {
        const ids = new Set();
        sectionHints.forEach((h) => {
            const el = findSectionWrapper(h);
            if (el?.id) ids.add(el.id.replace("shopify-section-", ""));
        });
        return Array.from(ids);
    }

    function payload() {
        return {
            sections: sectionIds(),
            sections_url: location.pathname + location.search,
        };
    }

    function swap(sections) {
        if (!sections) return;
        Object.entries(sections).forEach(([id, html]) => {
            const el = document.getElementById("shopify-section-" + id);
            if (el && typeof html === "string") el.outerHTML = html;
        });
        document.dispatchEvent(
            new CustomEvent("cart:updated", { detail: { sections } })
        );
        if (window?.initHeader) window.initHeader();
    }

    function badge(count) {
        const el = document.querySelector(
            "#cartCount, .cart-badge, [data-cart-count]"
        );
        if (el) {
            el.textContent = count > 0 ? String(count) : "";
            el.classList?.toggle("hidden", !(count > 0));
        }
    }

    async function fallbackRefresh() {
        const ids = sectionIds();
        if (!ids.length) return;

        const qsBase = new URLSearchParams({
            sections_url: location.pathname + location.search,
        }).toString();

        // Try the current route first, then root (some setups only render on "/")
        const bases = [location.pathname, "/"];

        for (const id of ids) {
            let ok = false;
            for (const base of bases) {
                const url = `${base}?section_id=${encodeURIComponent(
                    id
                )}&${qsBase}`;
                try {
                    const res = await fetch(url, {
                        credentials: "same-origin",
                        cache: "no-store",
                    });
                    if (res.ok) {
                        const html = await res.text();
                        const el = document.getElementById(
                            "shopify-section-" + id
                        );
                        if (el && typeof html === "string") el.outerHTML = html;
                        ok = true;
                        break;
                    }
                } catch (_) {
                    /* keep trying */
                }
            }
            if (!ok) console.warn("Could not refresh section:", id);
        }

        document.dispatchEvent(new CustomEvent("cart:updated"));
        if (window?.initHeader) window.initHeader();
    }
    async function post(url, data) {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-Requested-With": "XMLHttpRequest", // <-- helps Shopify return sections
            },
            credentials: "same-origin",
            body: JSON.stringify({ ...data, ...payload() }),
        });
        if (!res.ok) throw new Error("Network");
        return res.json();
    }

    async function changeLine(line, quantity) {
        const cart = await post("/cart/change.js", { line, quantity });
        if (cart?.sections) swap(cart.sections);
        else await fallbackRefresh();
        badge(cart?.item_count ?? 0);
        return cart;
    }

    const inflight = new Set();
    async function changeLineSafe(line, qty) {
        if (inflight.has(line)) return;
        inflight.add(line);

        // disable UI for this line (cart page)
        const group = document.querySelector(
            `.quantity-controls[data-line="${line}"]`
        );
        const btns = group ? Array.from(group.querySelectorAll("button")) : [];
        btns.forEach((b) => (b.disabled = true));

        try {
            return await changeLine(line, qty);
        } catch (e) {
            console.error(e);
            // optional: try a soft refresh so UI never gets stuck
            await window.ShopCart.refresh?.();
        } finally {
            inflight.delete(line);
            btns.forEach((b) => (b.disabled = false));
        }
    }

    async function add(id, quantity) {
        const cart = await post("/cart/add.js", { id, quantity });
        if (cart?.sections) swap(cart.sections);
        else await fallbackRefresh();
        badge(cart?.item_count ?? 0);
        return cart;
    }

    async function clear() {
        const cart = await post("/cart/clear.js", {});
        if (cart?.sections) swap(cart.sections);
        else await fallbackRefresh();
        badge(0);
        return cart;
    }

    // expose a tiny API
    window.ShopCart = {
        add,
        clear,
        changeLine,
        changeLineSafe,
        ensureHint(hint) {
            sectionHints.add(hint);
        },
        refresh: fallbackRefresh,
    };
})();
