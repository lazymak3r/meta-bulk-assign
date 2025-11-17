# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Shopify app built using the Node.js template. The app consists of an Express backend that handles OAuth authentication, GraphQL/REST API calls to Shopify Admin API, and a React frontend built with Vite. The app is configured with access scope `write_products`.

## Architecture

### Monorepo Structure

This is a workspace-based monorepo with three workspaces:
- `web` - Express backend server
- `web/frontend` - React frontend application
- `extensions/*` - Shopify app extensions (currently empty)

### Backend (`web/`)

- **Entry Point**: `web/index.js` - Main Express server configuration
- **Shopify Configuration**: `web/shopify.js` - Configures the Shopify App with authentication, webhooks, and session storage
- **Session Storage**: SQLite database (`database.sqlite`) stores session data
- **Authentication**: OAuth flow handled by `@shopify/shopify-app-express`
  - Auth path: `/api/auth`
  - Callback path: `/api/auth/callback`
- **API Routes**: All API routes are under `/api/*` and require authenticated sessions
- **Webhooks**: Mandatory privacy webhooks defined in `web/privacy.js`:
  - `CUSTOMERS_DATA_REQUEST`
  - `CUSTOMERS_REDACT`
  - `SHOP_REDACT`

### Frontend (`web/frontend/`)

- **Framework**: React 18 with Vite for building
- **UI Library**: Shopify Polaris for components
- **Routing**: File-based routing via `Routes.jsx`
  - Files in `/pages` automatically become routes
  - Example: `/pages/index.jsx` → `/`, `/pages/blog/[id].jsx` → `/blog/:id`
- **State Management**: React Query for API data fetching
- **App Bridge**: `@shopify/app-bridge-react` for embedded app functionality
- **Internationalization**: i18next with Shopify i18n plugin
  - Translation files in `web/frontend/locales/`

## Common Commands

### Development

```bash
# Start development server (runs both backend and frontend with HMR)
npm run dev

# Development mode runs through Shopify CLI which handles:
# - Tunneling via ngrok (or custom tunnel with --tunnel-url flag)
# - Environment variable setup
# - URL configuration
```

### Backend Development

```bash
# Run backend in development mode with nodemon
cd web && npm run dev

# Debug backend with inspector
cd web && npm run debug

# Run backend in production mode
cd web && npm run serve
```

### Frontend Development

```bash
# Run frontend dev server (Vite)
cd web/frontend && npm run dev

# Build frontend for production
cd web/frontend && npm run build
# Note: SHOPIFY_API_KEY environment variable required for build

# Run frontend tests with coverage
cd web/frontend && npm run coverage
```

### Shopify CLI Commands

```bash
# Get app information
npm run info

# Generate new app components
npm run generate

# Build the app
npm run build

# Deploy the app
npm run deploy
```

### Docker

```bash
# Build Docker image (requires SHOPIFY_API_KEY build arg)
docker build --build-arg SHOPIFY_API_KEY=your_key_here -t warranty-assign .

# Container exposes port 8081
```

## Key Integration Points

### Adding New API Endpoints

1. Add routes in `web/index.js` after line 40 (after `app.use(express.json())`)
2. All routes under `/api/*` automatically require authentication
3. Access Shopify session via `res.locals.shopify.session`
4. Use GraphQL client: `new shopify.api.clients.Graphql({ session })`
5. Example pattern in `web/index.js:42-56` (products count endpoint)

### Adding New Frontend Pages

1. Create `.jsx` file in `web/frontend/pages/`
2. Export default React component
3. Route is automatically created based on filename
4. Add navigation link in `App.jsx` NavMenu if needed

### Adding New Frontend Routes Outside `/api`

If adding routes outside of the `/api` path in the backend, remember to also add a proxy rule in `web/frontend/vite.config.js`.

### GraphQL Queries

- Use `shopify.api.clients.Graphql` for Admin API queries
- Example mutation pattern in `web/product-creator.js`
- Handle `GraphqlQueryError` exceptions

### Environment Variables

- `SHOPIFY_API_KEY` - Required for frontend build and runtime
- `BACKEND_PORT` / `PORT` - Backend server port (default: 3000)
- `NODE_ENV` - Set to "production" for production builds
- In development, Shopify CLI provides these automatically

## Important Configuration Files

- `shopify.app.toml` - Shopify app configuration (client_id, scopes, webhooks API version)
- `web/shopify.js` - Shopify app initialization with billing, auth, webhook, and session storage config
- `web/frontend/vite.config.js` - Vite build configuration and HMR setup

## Production Deployment Notes

- Frontend must be built before deployment: `cd web/frontend && SHOPIFY_API_KEY=your_key npm run build`
- Backend serves built frontend from `web/frontend/dist` in production
- SQLite session storage works for single-instance deployments only
- For multi-instance deployments, replace SQLite with a shared session storage solution
- Set `NODE_ENV=production` in production environment