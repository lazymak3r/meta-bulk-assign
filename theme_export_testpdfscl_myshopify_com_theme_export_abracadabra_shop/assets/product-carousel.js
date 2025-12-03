/**
 * Product Card Carousel Functionality
 * Handles image carousel with dot navigation for multiple product cards
 */

class ProductCarousel {
    constructor() {
        this.init();
    }

    init() {
        // Initialize all product carousels on the page
        this.initCarousels();

        // Add event listeners for dot navigation
        this.addDotEventListeners();
    }

    initCarousels() {
        const productCards = document.querySelectorAll(".product-card");

        productCards.forEach((card) => {
            const productId = card.getAttribute("data-product-id");
            const slider = card.querySelector(".product-images-slider");
            const dots = card.querySelectorAll(".product-dot");

            if (slider && dots.length > 1) {
                // Set initial state
                this.setActiveSlide(slider, 0);
                this.updateDots(dots, 0);
            }
        });
    }

    addDotEventListeners() {
        document.addEventListener("click", (e) => {
            if (e.target.classList.contains("product-dot")) {
                e.preventDefault();

                const dot = e.target;
                const productId = dot.getAttribute("data-product-id");
                const slideIndex = parseInt(dot.getAttribute("data-slide"));

                // Find the corresponding product card
                const productCard = document.querySelector(
                    `[data-product-id="${productId}"]`
                );
                if (!productCard) return;

                const slider = productCard.querySelector(
                    ".product-images-slider"
                );
                const dots = productCard.querySelectorAll(".product-dot");

                if (slider && dots.length > 0) {
                    this.goToSlide(slider, dots, slideIndex);
                }
            }
        });
    }

    goToSlide(slider, dots, slideIndex) {
        // Calculate the transform value
        const translateX = -(slideIndex * 100);

        // Apply the transform
        slider.style.transform = `translateX(${translateX}%)`;

        // Update active dot
        this.updateDots(dots, slideIndex);

        // Add sliding class for smooth transition
        slider.classList.add("sliding");

        // Remove sliding class after transition
        setTimeout(() => {
            slider.classList.remove("sliding");
        }, 400);
    }

    setActiveSlide(slider, slideIndex) {
        const translateX = -(slideIndex * 100);
        slider.style.transform = `translateX(${translateX}%)`;
    }

    updateDots(dots, activeIndex) {
        dots.forEach((dot, index) => {
            if (index === activeIndex) {
                dot.classList.add("active");
                dot.classList.remove("smaller");
            } else {
                dot.classList.remove("active");
                dot.classList.add("smaller");
            }
        });
    }

    // Public method to go to specific slide (can be called externally)
    static goToSlideForProduct(productId, slideIndex) {
        const productCard = document.querySelector(
            `[data-product-id="${productId}"]`
        );
        if (!productCard) return;

        const slider = productCard.querySelector(".product-images-slider");
        const dots = productCard.querySelectorAll(".product-dot");

        if (slider && dots.length > 0) {
            const carousel = new ProductCarousel();
            carousel.goToSlide(slider, dots, slideIndex);
        }
    }
}

// Initialize carousel when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    new ProductCarousel();
});

// Re-initialize carousel for dynamically loaded content
document.addEventListener("shopify:section:load", () => {
    new ProductCarousel();
});

// Handle AJAX-loaded content
if (typeof window.Shopify !== "undefined") {
    window.Shopify.onPageLoad = () => {
        new ProductCarousel();
    };
}
