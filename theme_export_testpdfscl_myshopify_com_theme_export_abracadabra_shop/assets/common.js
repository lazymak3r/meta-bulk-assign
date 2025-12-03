function loadYoutubeThumbnail(elementId, videoId) {
     const targetImg = document.getElementById(elementId);

  const sizes = [
    { name: "maxresdefault", minWidth: 800 }, // требуем ширину больше, чем у hq (чтобы отличать от fallback)
    { name: "sddefault",     minWidth: 600 },
    { name: "hqdefault",     minWidth: 300 },
    { name: "mqdefault",     minWidth: 200 },
    { name: "default",       minWidth: 1   }
  ];

  function tryIndex(i) {
    if (i >= sizes.length) {
      // если ничего не подошло — ставим дефолт (на всякий случай)
      targetImg.src = `https://img.youtube.com/vi/${videoId}/default.jpg`;
      return;
    }

    const size = sizes[i];
    const url = `https://img.youtube.com/vi/${videoId}/${size.name}.jpg`;
    const tester = new Image();

    tester.onload = function () {
      const w = tester.naturalWidth || 0;
      const h = tester.naturalHeight || 0;
      // Для отладки можно раскомментировать:
      // console.log(size.name, url, '=>', w, 'x', h);

      // Если картинка реального размера >= порог — принимаем её.
      if (w >= size.minWidth) {
        targetImg.src = url;
      } else {
        // иначе считаем, что это fallback (маленькая картинка) — пробуем следующий вариант
        tryIndex(i + 1);
      }
    };

    tester.onerror = function () {
      // не загрузилось — пробуем следующий
      tryIndex(i + 1);
    };

    // Запускаем загрузку
    tester.src = url + '?_t=' + Date.now(); // cache-bust на случай кеширования
  }

  tryIndex(0);
}

// Swap e-catalog-viewer-simple catalog-id for mobile when data-mobile-catalog-id is present
document.addEventListener("DOMContentLoaded", () => {
    try {
        const viewers = document.querySelectorAll(
            "e-catalog-viewer-simple[data-mobile-catalog-id]"
        );
        if (!viewers.length) return;

        const mq = window.matchMedia("(max-width: 767px)");

        viewers.forEach((el) => {
            const mobileId = el.getAttribute("data-mobile-catalog-id");
            if (!mobileId) return;
            const desktopId = el.getAttribute("catalog-id");

            function apply() {
                const useMobile = mq.matches;
                const nextId = useMobile ? mobileId : desktopId;
                if (el.getAttribute("catalog-id") !== nextId) {
                    el.setAttribute("catalog-id", nextId);
                    try {
                        el.catalogId = nextId;
                    } catch (_) {}
                }
            }

            apply();
            if (typeof mq.addEventListener === "function") {
                mq.addEventListener("change", apply);
            } else if ("onchange" in mq) {
                mq.onchange = apply;
            } else if (typeof mq.addListener === "function") {
                // Legacy Safari fallback
                mq.addListener(apply);
            }
        });
    } catch (_) {}
});
