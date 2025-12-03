(function () {
    const btn = document.getElementById("menuBtn");
    const nav = document.getElementById("mobileNav");

    // Mobile menu logic (guarded so rest of file still runs when menu elements are absent)
    if (btn && nav) {
        const toggle = () => {
            const open = btn.getAttribute("aria-expanded") === "true";
            btn.setAttribute("aria-expanded", String(!open));
            nav.classList.toggle("hidden", open);
            document.body.classList.toggle("overflow-hidden", !open);
        };

        btn.addEventListener("click", toggle);

        // Close when clicking any link inside mobile nav
        nav.addEventListener("click", (e) => {
            const a = e.target.closest("a,button");
            if (!a) return;
            // close only if panel is open
            if (btn.getAttribute("aria-expanded") === "true") toggle();
        });

        // Optional: close on ESC
        document.addEventListener("keydown", (e) => {
            if (
                e.key === "Escape" &&
                btn.getAttribute("aria-expanded") === "true"
            )
                toggle();
        });

        document.addEventListener("DOMContentLoaded", () => {
            window.addEventListener(
                "scroll",
                () => {
                    if (!nav) return;
                    if (!nav.classList.contains("hidden") && scrollY > 0) {
                        toggle();
                    }
                },
                true
            );
            window.addEventListener("click", (e) => {
                if (!nav) return;
                const composedPath = e.composedPath();
                if (
                    !nav.classList.contains("hidden") &&
                    composedPath.indexOf(btn) === -1 &&
                    composedPath.indexOf(nav) === -1
                ) {
                    toggle();
                }
            });
        });
    }

    // Mobile search toggle: show desktop input and hide icons
    document.addEventListener("DOMContentLoaded", () => {
        try {
            const mobileSearchBtn = document.getElementById("mobileSearchBtn");
            const headerRight = document.querySelector(".header-right");
            const searchInput = document.querySelector(
                ".header-right .search-input"
            );
            const searchDropdown = document.getElementById("search-dropdown");
            if (mobileSearchBtn && headerRight && searchInput) {
                const closeSearch = () => {
                    headerRight.classList.remove("search-open");
                    mobileSearchBtn.setAttribute("aria-expanded", "false");
                    if (searchDropdown) searchDropdown.style.display = "none";
                    // recalc mini-cart position if header height changed
                    if (window.__updateMiniCartTop)
                        window.__updateMiniCartTop();
                };
                const openSearch = () => {
                    headerRight.classList.add("search-open");
                    mobileSearchBtn.setAttribute("aria-expanded", "true");
                    setTimeout(() => searchInput.focus(), 0);
                    // recalc mini-cart position if header height changed
                    if (window.__updateMiniCartTop)
                        window.__updateMiniCartTop();
                };
                mobileSearchBtn.addEventListener("click", () => {
                    const isOpen =
                        headerRight.classList.contains("search-open");
                    if (isOpen) {
                        closeSearch();
                    } else {
                        openSearch();
                    }
                });

                // Close on ESC
                document.addEventListener("keydown", (e) => {
                    if (
                        e.key === "Escape" &&
                        headerRight.classList.contains("search-open")
                    ) {
                        closeSearch();
                    }
                });

                // Click outside closes
                window.addEventListener(
                    "click",
                    (e) => {
                        const cp = e.composedPath();
                        if (!headerRight.classList.contains("search-open"))
                            return;
                        if (
                            cp.indexOf(headerRight) === -1 &&
                            cp.indexOf(mobileSearchBtn) === -1
                        )
                            closeSearch();
                    },
                    true
                );
            }
        } catch (err) {}
    });

    // Mini-cart top position: keep popover below header on mobile
    // Uses CSS var --mini-cart-top consumed in theme.css
    const setupMiniCartTop = () => {
        const header = document.querySelector("header");
        if (!header) return;

        const update = () => {
            const rect = header.getBoundingClientRect();
            const topPx = Math.max(0, Math.round(rect.bottom + 10 + 15));
            document.documentElement.style.setProperty(
                "--mini-cart-top",
                `${topPx}px`
            );
        };

        // expose for other scripts in this file
        window.__updateMiniCartTop = update;

        // initial (run now, then again after load & fonts)
        update();
        window.addEventListener("load", update, { once: true });
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => update());
        }

        // throttle updates with rAF
        let rafId = 0;
        const schedule = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                update();
            });
        };

        // react to header intrinsic size changes
        if ("ResizeObserver" in window) {
            const ro = new ResizeObserver(schedule);
            ro.observe(header);
        }

    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setupMiniCartTop);
    } else {
        setupMiniCartTop();
    }
})();
