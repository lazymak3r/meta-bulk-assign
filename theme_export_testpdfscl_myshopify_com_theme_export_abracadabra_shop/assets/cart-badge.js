(() => {
    const badge = document.getElementById("cartCount");

    function setBadge(n) {
        if (!badge) return;
        if (n > 0) {
            badge.textContent = String(n);
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
            badge.textContent = "";
        }
    }

    async function refreshCartCount() {
        const res = await fetch("/cart.js", {
            headers: { Accept: "application/json" },
        });
        const data = await res.json();
        setBadge(data.item_count || 0);
        document.dispatchEvent(
            new CustomEvent("cart:updated", { detail: data })
        );
    }

    document.addEventListener("DOMContentLoaded", refreshCartCount);
    window.refreshCartCount = refreshCartCount;

    // unified AJAX product form handler
    document.addEventListener("submit", async (e) => {
        const form = e.target.closest(".js-product-form");
        if (!form) return;
        // If a form opts into a custom ATC flow (e.g. PDP with add-ons),
        // let that handler take over and do nothing here.
        if (form.dataset && form.dataset.customAtc === "1") return;
        // Respect earlier handlers that prevented default
        if (e.defaultPrevented) return;
        e.preventDefault();

        const btn = form.querySelector(".js-atc");
        const labelEl = form.querySelector(".js-atc-label");
        const oldLabel = labelEl?.textContent;

        try {
            if (btn) btn.disabled = true;
            if (labelEl) labelEl.textContent = "Wird hinzugefügt…";

            const fd = new FormData(form);
            const res = await fetch("/cart/add.js", {
                method: "POST",
                headers: { Accept: "application/json" },
                body: fd,
            });
            if (!res.ok) throw new Error("Add to cart failed");

            await refreshCartCount();
            document.dispatchEvent(new CustomEvent("cart:item-added"));

            if (window.showMiniCartPopover) {
                window.showMiniCartPopover();
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (btn) btn.disabled = false;
            if (labelEl && oldLabel) labelEl.textContent = oldLabel;
        }
    });
})();
