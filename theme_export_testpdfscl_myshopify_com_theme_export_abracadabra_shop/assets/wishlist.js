function clearWishlist() {
    localStorage.setItem("favorites", []);
    window.location.reload();
}

function removeFromWishlist(handle) {
    const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
    const updated = favorites.filter((h) => h !== handle);
    localStorage.setItem("favorites", JSON.stringify(updated));
    location.reload(); // или пересобери HTML вручную
}

function updateWishlistCount() {
    const favorites =
        JSON.parse(localStorage.getItem("favorites") || "[]") || [];
    const countEl = document.getElementById("wishlistCount");

    if (!countEl) return;

    countEl.textContent = favorites.length;

    if (favorites.length > 0) {
        countEl.classList.remove("hidden");
    } else {
        countEl.classList.add("hidden");
    }
}

function addToFavorites(product) {
    const key = product.handle;
    if (!key) return; // ignore invalid buttons
    let favorites = JSON.parse(localStorage.getItem("favorites") || "[]") || [];

    if (favorites.includes(String(key))) {
        // Убираем из избранного
        favorites = favorites.filter((id) => String(id) !== String(key));
    } else {
        // Добавляем в избранное
        favorites.push(String(key));
    }

    localStorage.setItem("favorites", JSON.stringify(favorites));

    updateWishlistCount();

    // Синхронизируем другие кнопки того же товара
    const event = new CustomEvent("favorite:updated", {
        detail: {
            handle: String(key),
            inFavorites: favorites.includes(String(key)),
        },
    });
    document.dispatchEvent(event);
}

document.addEventListener("DOMContentLoaded", () => {
    const favoriteButtons = document.querySelectorAll(".favorite-btn");

    // Получаем текущий список избранного из localStorage
    const favorites =
        JSON.parse(localStorage.getItem("favorites") || "[]") || [];

    // Обновляем кнопки при загрузке
    favoriteButtons.forEach((btn) => {
        const key =
            btn.dataset.productHandle ||
            btn.dataset.handle ||
            btn.dataset.productId ||
            "";
        if (favorites.includes(String(key))) {
            //btn.textContent = '❤️ Favorited';
            btn.classList.add("favorited");
        }
    });

    updateWishlistCount();

    favoriteButtons.forEach((btn) => {
        if (btn.__wishlistBound) return;
        btn.__wishlistBound = true;
        btn.addEventListener("click", () => {
            const key =
                btn.dataset.productHandle ||
                btn.dataset.handle ||
                btn.dataset.productId ||
                "";
            if (!key) return; // ignore invalid buttons
            let favorites =
                JSON.parse(localStorage.getItem("favorites") || "[]") || [];

            if (favorites.includes(String(key))) {
                // Убираем из избранного
                favorites = favorites.filter(
                    (id) => String(id) !== String(key)
                );
                //btn.textContent = '❤️ Add to Favorites';
                btn.classList.remove("favorited");
            } else {
                // Добавляем в избранное
                favorites.push(String(key));
                //btn.textContent = '❤️ Favorited';
                btn.classList.add("favorited");
            }

            localStorage.setItem("favorites", JSON.stringify(favorites));

            updateWishlistCount();

            // Синхронизируем другие кнопки того же товара
            const event = new CustomEvent("favorite:updated", {
                detail: {
                    handle: String(key),
                    inFavorites: favorites.includes(String(key)),
                },
            });
            document.dispatchEvent(event);

            // Снимаем фокус на десктопе, чтобы не залипало состояние hover/focus
            if (
                window.matchMedia &&
                window.matchMedia("(hover: hover) and (pointer: fine)").matches
            ) {
                setTimeout(() => btn.blur(), 0);
            }
        });
    });
});

document.addEventListener("favorite:updated", (e) => {
    const handle = e.detail?.handle;
    const inFav = !!e.detail?.inFavorites;
    if (!handle) return;
    document
        .querySelectorAll(
            `.favorite-btn[data-product-handle="${handle}"],
       .favorite-btn[data-handle="${handle}"],
       .favorite-btn[data-product-id="${handle}"]`
        )
        .forEach((btn) => btn.classList.toggle("favorited", inFav));
});

// Observe DOM for dynamically added favorite buttons (after AJAX/filter swaps)
try {
    const wishlistObserver = new MutationObserver((mutations) => {
        let changed = false;
        const favorites =
            JSON.parse(localStorage.getItem("favorites") || "[]") || [];

        mutations.forEach((m) => {
            if (!m.addedNodes || !m.addedNodes.length) return;
            m.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) return;
                const candidates = [];
                if (node.matches && node.matches(".favorite-btn"))
                    candidates.push(node);
                node.querySelectorAll &&
                    candidates.push(...node.querySelectorAll(".favorite-btn"));

                candidates.forEach((btn) => {
                    const key =
                        btn.dataset.productHandle ||
                        btn.dataset.handle ||
                        btn.dataset.productId ||
                        "";
                    if (favorites.includes(String(key))) {
                        btn.classList.add("favorited");
                    } else {
                        btn.classList.remove("favorited");
                    }

                    if (!btn.__wishlistBound) {
                        btn.__wishlistBound = true;
                        btn.addEventListener("click", () => {
                            const handle =
                                btn.dataset.productHandle ||
                                btn.dataset.handle ||
                                btn.dataset.productId ||
                                "";
                            if (!handle) return;
                            let list =
                                JSON.parse(
                                    localStorage.getItem("favorites") || "[]"
                                ) || [];

                            if (list.includes(String(handle))) {
                                list = list.filter(
                                    (id) => String(id) !== String(handle)
                                );
                                btn.classList.remove("favorited");
                            } else {
                                list.push(String(handle));
                                btn.classList.add("favorited");
                            }

                            localStorage.setItem(
                                "favorites",
                                JSON.stringify(list)
                            );
                            updateWishlistCount();
                            const event = new CustomEvent("favorite:updated", {
                                detail: {
                                    handle: String(handle),
                                    inFavorites: list.includes(String(handle)),
                                },
                            });
                            document.dispatchEvent(event);

                            if (
                                window.matchMedia &&
                                window.matchMedia(
                                    "(hover: hover) and (pointer: fine)"
                                ).matches
                            ) {
                                setTimeout(() => btn.blur && btn.blur(), 0);
                            }
                        });
                    }

                    changed = true;
                });
            });
        });

        if (changed) updateWishlistCount();
    });

    wishlistObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
} catch (_) {}
