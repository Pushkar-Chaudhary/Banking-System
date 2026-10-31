# Sajilo Pasal

React storefront and Express/MongoDB marketplace API in one deployable Node.js service.

## Run locally

Requirements: Node.js 22+ and a MongoDB deployment. Configure the existing local `.env` with the settings below; do not commit it.

```powershell
npm install
npm run dev:all
```

This starts the Express API and Vite storefront together; open the Local URL printed by Vite (it automatically selects an available port). Press Ctrl+C to stop both. The storefront dev server proxies `/api` to Express on port 3000. To start either part separately, use `npm run dev` (API) or `npm run dev:client` (storefront). For a production build served by Express, run:

```powershell
npm run build
npm start
```

Run the test suite with `npm test` (`node --test`). It covers session-based authentication and password reset, production email configuration, image validation, checkout and stock reservation, seller credential encryption, Gemini meal catalog grounding, eSewa signing, and role switching.

To add local, purchaseable demo listings for storefront development, configure `DEMO_SELLER_PASSWORD` privately in `.env` (at least 12 characters), then run `npm run seed:demo`. The seeder is disabled when `NODE_ENV=production`; demo listings can be ordered with cash on delivery and the local seller account can be used to manage fulfillment. Do not use demo listings in a live marketplace.

## Configuration

The server loads `.env` at startup. Configure:

- `MONGO_URI`, `JWT_SECRET` (a fresh random secret), and `JWT_EXPIRES_IN`
- Optional `MONGO_DNS_SERVERS` for local Node.js DNS issues: a comma-separated list such as `1.1.1.1`. This changes DNS servers for the Node.js process only; prefer your trusted network resolver when it works.
- `PORT`, `NODE_ENV`, `API_PUBLIC_URL`, and `FRONTEND_URL`
- `TRUST_PROXY` (`false` by default; set to `1` or the exact number of proxies when running behind a reverse proxy/load balancer so rate limiting sees real client IPs)
- `SELLER_PAYMENT_ENCRYPTION_KEY`: base64 encoding of a randomly generated 32-byte key. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and store it in the hosting secret manager. Losing this key makes saved seller secrets unusable; rotate it only with a planned credential re-encryption.
- `ESEWA_BASE_URL` and `ESEWA_ENV` (`uat` or `production`). Optionally set `ESEWA_STATUS_URL`.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to enable seller image uploads.
- Optional `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey) to enable the Gemini meal planner. Keep this key on the server; never expose it through a `VITE_` variable.
- Email delivery using SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) or the existing Gmail options (`EMAIL_USER` with `EMAIL_PASS`, or OAuth via `EMAIL_USER`, `CLIENT_ID`, `CLIENT_SECRET`, and `REFRESH_TOKEN`). Production registration verification and password recovery require a configured email provider.

For a production deployment, serve the frontend and API from the same HTTPS origin. Point `API_PUBLIC_URL` to that public origin so eSewa can return to `/api/v1/payments/esewa/callback`; set `FRONTEND_URL` to the storefront origin. Configure eSewa with the production merchant values supplied by eSewa. Do not use UAT credentials for live transactions. MongoDB must support transactions (MongoDB Atlas or a replica set) because checkout reserves inventory and creates orders atomically.

### Deploy as one Vercel project

1. Import this repository into Vercel and set the project root to the repository root. Keep the frontend and API in this same project.
2. Use the Vite framework preset, build command `npm run build`, and output directory `dist`. These settings and the `/api/*` and `/health` rewrites are already defined in the root `vercel.json`.
3. Add `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `API_PUBLIC_URL`, `FRONTEND_URL`, `TRUST_PROXY=1`, and `SELLER_PAYMENT_ENCRYPTION_KEY` to the Vercel Production environment. Add `GEMINI_API_KEY` if enabling the meal planner. Use the same HTTPS site origin for `API_PUBLIC_URL` and `FRONTEND_URL`. Keep `VITE_API_BASE_URL` unset so the storefront calls the API on the same origin. Vercel sets `NODE_ENV`.
4. To enable registration and password-recovery emails, configure either Gmail OAuth (`EMAIL_USER`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`) or SMTP. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to enable persistent product image uploads. Configure the sellers' eSewa credentials in Seller Studio before accepting online payments.
5. Add the same required settings to Preview if you want to test deployed previews, including `GEMINI_API_KEY` if you want to test meal ideas there. Set their public URLs to a stable HTTPS preview domain before testing authentication or payments. Deploy from the Vercel dashboard or run `vercel` for a preview and `vercel --prod` for production after linking the repository.

The Vercel function in `api/index.js` serves the Express API; Vercel serves the Vite build from `dist`. This is one project and one deployment—do not create a separate frontend or backend project. Local Vercel project metadata and environment files are ignored by Git.

The browser authenticates through a persistent HttpOnly cookie; JWTs are not stored in browser local storage. For production, keep the storefront and API on the same origin. If they must use separate origins, configure both URLs and use HTTPS for both. Vercel preview deployments also need their environment-specific `API_PUBLIC_URL` and `FRONTEND_URL` if you want to test payments there.

### First administrator

Register the administrator account through the normal register flow, then promote that account once using an authenticated MongoDB administration session:

```javascript
db.users.updateOne(
  { email: "admin@example.com" },
  { $set: { role: "admin" } }
)
```

The Mongoose model collection name may be lowercased/pluralized by Mongoose; check your collection name before running this command. Never expose database credentials in a public shell or source file. After promotion, manage seller roles from the admin dashboard.

## Docker deployment

Build the production image with `docker build -t sajilo-pasal .`, then run it with a secret-managed environment, for example:

```powershell
docker run --env-file .env -p 3000:3000 sajilo-pasal
```

Use a managed MongoDB replica set and an HTTPS reverse proxy/hosting platform in production. Keep `.env` outside the image and supply secrets through the hosting platform's secret manager.

## Payment and inventory notes

- Checkout ignores submitted prices and totals; it prices products from MongoDB and atomically verifies/decrements stock.
- Checkout is idempotent: the storefront sends one `checkoutId` per checkout attempt, and re-submitting the same checkout (double click or network retry) returns the orders that were already created instead of duplicating them.
- Account recovery uses `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password`. Reset codes are 6-digit OTPs stored with a 10-minute TTL and are deleted after use. Sign-in, registration, and password reset endpoints are rate limited.
- Product listings are Nepal-only and record province, district, municipality, and optional ward. Buyers can filter by province/district; the initial catalog seeds vegetables, drinks, medical supplies, grocery, household, personal care, and other local goods.
- Signup supports buyer or seller mode. People can switch modes later; seller listings are hidden in buyer mode and restored when switching back. Switching away from seller mode is blocked while the seller still has unfulfilled order items.
- Each seller can connect their eSewa merchant code and API secret from Seller Studio. Secrets are encrypted at rest with AES-256-GCM and are never returned by the API. The app does not ask for eSewa login passwords. A seller's merchant account must be enabled for the configured eSewa environment.
- A multi-seller checkout creates one separate order and eSewa transaction per seller, so each payment is sent directly to that seller's merchant account. Each seller's delivery fee is calculated separately. Buyers return to the checkout payment page after each eSewa transaction to pay the next seller.
- eSewa initiation signs the server-calculated seller-order total. Callback signatures and the eSewa transaction-status endpoint are both verified before marking an order paid.
- Cash on delivery is available. Bank transfer is not exposed as an online payment option because this project has no bank API credentials or automated bank reconciliation endpoint.
- Seller image upload stores images in Cloudinary. Product image URL entry remains available as a fallback.

Before going live, set `SELLER_PAYMENT_ENCRYPTION_KEY`, have each seller connect actual production merchant credentials, complete low-value transactions for multiple sellers, verify callbacks and order-state behavior, and perform a deployment smoke test. Payment and email features cannot operate without their respective provider credentials.
