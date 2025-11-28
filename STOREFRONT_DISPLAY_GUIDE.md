# Storefront Metafield Display - Setup & Testing Guide

## Overview

This feature allows metafields assigned through the Meta Bulk Assign app to **automatically appear on product pages** in the storefront. No manual theme editing required after initial setup!

## What We've Built

### 1. **Database Changes**
- Added `show_on_storefront` column (boolean) - toggle to show/hide on storefront
- Added `storefront_position` column (text) - where to display (after_price, before_cart, etc.)

### 2. **App Embed Extension**
- Location: `extensions/storefront-display/`
- JavaScript that automatically injects metafields into product pages
- Styles for professional display of text, images, files, and metaobjects

### 3. **Backend API**
- Endpoint: `/apps/meta-bulk-assign/api/storefront-config`
- Returns which metafields to display for each product
- Configured via App Proxy in `shopify.app.toml`

### 4. **UI Controls**
- New section in configuration editor: "Storefront Display"
- Checkbox: "Show on storefront"
- Dropdown: Position selector (after price, before cart, etc.)

---

## Setup Instructions

### Step 1: Deploy the App Extension

```bash
cd /Users/haykgyulabyan/projects/meta-bulk-assign
npm run deploy
```

This deploys:
- The existing Theme App Extension blocks (metafield-display)
- The new App Embed (storefront-display)

### Step 2: Enable App Embed in Theme

1. Go to Shopify Admin → Online Store → Themes
2. Click "Customize" on the client's theme
3. Click the "App embeds" icon (puzzle piece) in left sidebar
4. Find **"Metafield Auto Display"**
5. Toggle it **ON**
6. Click **Save**

✅ That's it! The app embed is now active.

---

## Testing Guide

### Test 1: Create a Configuration with Storefront Display

1. **Go to your Meta Bulk Assign app**
2. **Create or edit a configuration**
3. **Add metafield(s)** (e.g., vendor logo image, warranty text)
4. **Check "Show on storefront"**
5. **Select position**: "After price"
6. **Save the configuration**
7. **Apply to products**

### Test 2: View on Storefront

1. **Open a product page** where the metafield was applied
2. **Look after the price** - you should see the metafield displayed!

**Example Results:**
- **Text metafield**: Shows as formatted text
- **Image metafield**: Shows as responsive image with shadow
- **File metafield**: Shows as download button with icon
- **Metaobject**: Shows as key-value table

### Test 3: Change Position

1. **Edit the configuration**
2. **Change position** to "Before add to cart"
3. **Save**
4. **Refresh product page**
5. **Metafield should now appear before the cart button**

### Test 4: Toggle Off

1. **Edit configuration**
2. **Uncheck "Show on storefront"**
3. **Save**
4. **Refresh product page**
5. **Metafield should NOT appear**

---

## How It Works

### Flow:

```
1. Merchant creates configuration in app
   ↓
2. Enables "Show on storefront" + selects position
   ↓
3. Applies configuration to products (assigns metafields)
   ↓
4. Customer visits product page
   ↓
5. App Embed JavaScript loads
   ↓
6. JavaScript fetches config from app backend
   ↓
7. Backend returns: which metafields to show + their values
   ↓
8. JavaScript injects HTML at specified position
   ↓
9. Metafields appear on product page!
```

### Available Positions:

- **after_price** - Right after the product price
- **before_cart** - Right before the "Add to Cart" button
- **after_description** - Below product description
- **after_title** - Below product title

### Supported Metafield Types:

- ✅ **Text** (single_line_text_field, multi_line_text_field)
- ✅ **Image** (file_reference with image)
- ✅ **File/PDF** (file_reference with file)
- ✅ **Metaobject** (metaobject_reference)

---

## Troubleshooting

### Issue: Metafields don't appear on storefront

**Check:**
1. ✅ App Embed is enabled in Theme Editor → App Embeds
2. ✅ Configuration has "Show on storefront" checked
3. ✅ Configuration was applied to the product
4. ✅ Product actually has the metafield value assigned

**Debug:**
- Open browser DevTools (F12)
- Go to Console tab
- Look for `[MBA]` logs
- Should see: `[MBA] Config loaded:` with metafield data

### Issue: Metafields appear in wrong location

**Solution:**
- The theme might use different CSS selectors
- JavaScript tries multiple selectors per position
- If needed, update selectors in `extensions/storefront-display/snippets/meta-bulk-assign-display.liquid`

### Issue: Styling looks off

**Solution:**
- Customize CSS in `extensions/storefront-display/snippets/meta-bulk-assign-display.liquid`
- The `<style>` section at the bottom controls all styling

---

## Advanced: Customization

### Change Injection Point Selectors

Edit: `extensions/storefront-display/snippets/meta-bulk-assign-display.liquid`

Find the `findInjectionPoint` function:

```javascript
const selectors = {
  'after_price': [
    '.product__price',
    '.product-price',
    '[class*="price"]',
    // Add your theme's price selector here
  ],
  // ... other positions
};
```

### Customize Styling

Edit the `<style>` section at the bottom of the same file.

**Example - Change file button color:**

```css
.mba-metafield__file-link {
  background: #your-brand-color;
  color: white;
}
```

---

## Production Checklist

Before going live:

- [ ] App Embed enabled in production theme
- [ ] Tested on multiple products
- [ ] Tested all metafield types (text, image, file, metaobject)
- [ ] Tested all positions
- [ ] Styling looks good on mobile
- [ ] No JavaScript console errors
- [ ] App proxy configured in Partner Dashboard

---

## What's Next (Optional Enhancements)

Future improvements you could add:

1. **Rule Matching** - Currently shows on all products; could filter by vendor/collection
2. **Custom CSS Editor** - Let merchants customize styles from app UI
3. **Multiple Metafields** - Show multiple metafields from one configuration
4. **Analytics** - Track which metafields are displayed most often

---

## Questions?

If you encounter any issues, check:
1. Browser console for `[MBA]` debug logs
2. Network tab for API call to `/apps/meta-bulk-assign/api/storefront-config`
3. Make sure app proxy is configured in shopify.app.toml

Happy testing! 🚀
