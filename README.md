# First Sniffer — Backend

Express + TypeScript + MongoDB backend for the First Sniffer perfume-decants
storefront. Lives in a separate project from the Next.js frontend and talks to
it over HTTP using JWT-in-HttpOnly-cookie auth.

---

## 1. Project structure

```
backend/
├── docker/
│   └── docker-compose.yml       MongoDB + Mongo Express
├── src/
│   ├── app.ts                   Express app (middleware + routes)
│   ├── server.ts                Bootstraps DB + listens on PORT
│   ├── config/                  env, database, cookie
│   ├── middleware/              auth, admin, validateRequest, errorHandler, notFound
│   ├── utils/                   jwt, bcrypt, ApiError, sendResponse, asyncHandler
│   ├── routes/                  Aggregates every module router
│   ├── modules/
│   │   ├── auth/                register / login / logout / me
│   │   ├── user/                profile + addresses
│   │   └── checkout/            reserved for future orders/payments
│   └── types/
│       └── express.d.ts         Augments req.user
├── package.json
├── tsconfig.json
├── nodemon.json
├── .eslintrc.json
└── .env.example
```

Every future module (`products/`, `orders/`, `reviews/`, etc.) follows the same
shape as `modules/auth/`:

```
module-name/
├── module-name.controller.ts
├── module-name.service.ts
├── module-name.routes.ts
├── module-name.validation.ts
├── module-name.interface.ts
└── module-name.model.ts        (if it touches MongoDB)
```

---

## 2. Quick start

```bash
# 1. Start MongoDB + Mongo Express (Docker)
cd backend
docker compose -f docker/docker-compose.yml up -d

# 2. Install deps
npm install

# 3. Copy environment template and edit as needed
cp .env.example .env

# 4. Run in development (nodemon + ts-node)
npm run dev

# 5. Or build + start
npm run build
npm start
```

The API will be on `http://localhost:5000` and Mongo Express on
`http://localhost:8081` (login: `admin` / `password`).

---

## 3. Environment variables

All variables live in `.env`. Copy `.env.example` to get started.

| Key               | Default                                                                  | Description                              |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| `PORT`            | `5000`                                                                   | HTTP port                                |
| `NODE_ENV`        | `development`                                                            | Toggle prod-only behaviour               |
| `FRONTEND_URL`    | `http://localhost:3000`                                                  | Allowed CORS origin (must match frontend)|
| `MONGODB_URI`     | `mongodb://admin:password@localhost:27017/firstsniffer?authSource=admin`  | Matches docker-compose credentials       |
| `JWT_SECRET`      | `replace-this-with-a-long-random-string-in-production`                   | **Required**, sign JWT tokens with this  |
| `JWT_EXPIRES_IN`  | `7d`                                                                     | Token lifetime                           |
| `COOKIE_NAME`     | `fs_token`                                                               | Auth cookie name                         |
| `COOKIE_SECURE`   | `false`                                                                  | Set `true` in production (HTTPS only)    |
| `RESEND_API_KEY`  | _(empty)_                                                                | Resend API key — the only email provider  |
| `EMAIL_FROM`      | _(empty)_                                                                | Verified sender, e.g. `First Sniffer <x@y>` |

**Never commit `.env`.** It's listed in `.gitignore`.

### Email (Resend)

Email is the **only** customer notification channel — there is no SMS
integration. All outbound mail goes through the official `resend` SDK via
the single transport wrapper in `src/modules/email/email.service.ts`.

Two environment variables control it, and they are **optional**: when
either is missing the service reports `sent: false`, logs a sanitised
warning, and every business flow continues. A failed email never fails an
order, never rolls back a stock deduction, and never blocks a
registration.

| Variable         | Where to get it                          | Notes                                              |
| ---------------- | ---------------------------------------- | -------------------------------------------------- |
| `RESEND_API_KEY` | https://resend.com/api-keys              | Secret — never logged, never returned in a response |
| `EMAIL_FROM`     | Resend → Domains → your verified domain  | e.g. `First Sniffer <orders@yourdomain.com>`        |

**Setting up a sending domain**

1. Create a Resend account and add your domain under **Domains**.
2. Add the DNS records Resend gives you (usually `MX` plus a `TXT` for
   SPF and one for DKIM) at your DNS provider.
3. Wait for Resend to show the domain as **Verified**.
4. Set `EMAIL_FROM` to an address on that verified domain — for example
   `First Sniffer <orders@firstsniffer.com>`.

Until the domain is verified, Resend's sandbox sender only delivers to
the account owner's own address. Nothing else in the system changes: the
templates, the OTP flow, the resend limiter and the order-confirmation
email all work against the same sender.

### Customer email flows

| Flow              | Trigger                     | Notes                                                          |
| ----------------- | --------------------------- | -------------------------------------------------------------- |
| OTP verification  | `POST /api/auth/register`   | 6-digit code, 5-minute expiry, 5 attempts, bcrypt-hashed        |
| OTP resend        | `POST /api/auth/resend-otp` | Max 3 resends, then a 30-minute cooldown (`429` + `Retry-After`) |
| Password reset    | `POST /api/auth/forgot-password` | 15-minute code; identical response for known/unknown emails |
| Order confirmation | Order creation succeeds     | Skipped for admin-created orders and guests with no email        |

The resend limiter lives entirely in MongoDB — one atomic
`findOneAndUpdate` per request — so parallel requests cannot bypass it.
No Redis, BullMQ, or any other queue is involved.

---

## 4. Docker (MongoDB)

`docker/docker-compose.yml` runs two services:

- `mongodb` — `mongo:7`, port `27017`, persistent `firstsniffer_mongo_data` volume, restart policy `unless-stopped`, healthcheck.
- `mongo-express` — `mongo-express:1.0.2`, port `8081`, basic auth (`admin`/`password`), waits on a healthy Mongo.

Useful commands:

```bash
docker compose -f docker/docker-compose.yml up -d      # start
docker compose -f docker/docker-compose.yml down       # stop
docker compose -f docker/docker-compose.yml logs -f    # tail logs
docker compose -f docker/docker-compose.yml down -v    # wipe data
```

No local MongoDB install is needed — everything is containerised.

---

## 5. Scripts

| Script               | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Start nodemon + ts-node, hot reload on `src/`      |
| `npm run build`      | Type-check + emit `dist/`                          |
| `npm start`          | Run the compiled `dist/server.js`                  |
| `npm run typecheck`  | `tsc --noEmit` only                                |
| `npm run lint`       | ESLint over `src/**/*.ts`                          |
| `npm run docker:up`  | `docker compose -f docker/docker-compose.yml up -d`|
| `npm run docker:down`| `docker compose -f docker/docker-compose.yml down` |
| `npm run docker:logs`| Tail the Docker compose logs                       |

---

## 6. Authentication flow

- **Registration:** `POST /api/auth/register` validates with Zod, checks email uniqueness, hashes the password with bcrypt (12 rounds), creates the user as `role: 'customer'`, signs a JWT, and sets it as an HttpOnly cookie.
- **Login:** `POST /api/auth/login` looks the user up by email, verifies the password, signs a JWT, sets the cookie.
- **Session:** `GET /api/auth/me` returns the authenticated user. It reads the JWT from the `fs_token` cookie (or `Authorization: Bearer …`) and verifies it.
- **Logout:** `POST /api/auth/logout` clears the cookie.

JWTs are signed with `JWT_SECRET` and carry `{ sub, email, role }` claims.

Cookie flags:

- `HttpOnly` — inaccessible to JS (no XSS token theft)
- `SameSite=Lax` — protects against most CSRF while still allowing top-level navigation
- `Secure` — auto-enabled when `COOKIE_SECURE=true` or `NODE_ENV=production`

---

## 7. Standard response shape

Success:

```json
{
  "success": true,
  "message": "Login successful",
  "data": { "id": "…", "name": "…", "email": "…" }
}
```

Error:

```json
{
  "success": false,
  "message": "Invalid email or password",
  "errors": [],
  "data": null
}
```

Validation errors populate `errors` with `{ path, message }` per failing field.

---

## 8. API surface (v1)

### Health

| Method | Path                | Auth | Description       |
| ------ | ------------------- | ---- | ----------------- |
| GET    | `/api/health`       | —    | Liveness probe    |
| GET    | `/`                 | —    | Service banner    |

### Auth (`/api/auth`)

| Method | Path                | Auth | Description                                |
| ------ | ------------------- | ---- | ------------------------------------------ |
| POST   | `/api/auth/register`| —    | Create account, set cookie, auto-login     |
| POST   | `/api/auth/login`   | —    | Email + password login, sets cookie        |
| POST   | `/api/auth/logout`  | —    | Clears the auth cookie                     |
| GET    | `/api/auth/me`      | ✅   | Current authenticated user                 |

### User (`/api/users`)

| Method | Path                                      | Auth | Description               |
| ------ | ----------------------------------------- | ---- | ------------------------- |
| GET    | `/api/users/me`                           | ✅   | Profile                   |
| PATCH  | `/api/users/me`                           | ✅   | Update profile            |
| POST   | `/api/users/me/addresses`                 | ✅   | Add an address            |
| PATCH  | `/api/users/me/addresses/:addressId`      | ✅   | Update an address         |
| PUT    | `/api/users/me/addresses/:addressId/default` | ✅ | Mark an address default |
| DELETE | `/api/users/me/addresses/:addressId`      | ✅   | Remove an address         |

### Checkout (`/api/checkout`)

Reserved. The router is mounted so future endpoints can be added without
touching the aggregator.

---

## 9. Connecting the frontend

The Next.js app lives at `firstSniffer-frontend/` and was already wired up to
talk to this backend during setup.

```bash
# in firstSniffer-frontend/
cp .env.local.example .env.local       # already points to http://localhost:5000/api
npm install
npm run dev                            # http://localhost:3000
```

The frontend's `src/lib/api.ts` exposes an `axios` instance with
`withCredentials: true` so the auth cookie is sent automatically. `AuthProvider`
calls `/api/auth/me` on mount to hydrate the session.

To run both ends together:

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd firstSniffer-frontend && npm run dev
```

---

## 10. Architecture rules

- **Controllers are thin** — they read the request, call a service, format the response. No business logic.
- **Services hold business logic** — they throw `ApiError` and never write HTTP responses.
- **Validation is Zod-only** — every module has its own `*.validation.ts`. Controllers never `if (!req.body.email) return res.status(400)…`.
- **Errors flow through one handler** — `middleware/errorHandler.ts` normalises `ApiError`, Zod errors, Mongoose validation errors, duplicate-key errors, and unknown errors into the standard envelope.
- **One module, one folder** — auth, user, checkout, and every future module follow the same shape.

---

## 11. Troubleshooting

- **`MongoServerError: Authentication failed`** — make sure `MONGODB_URI` matches the credentials in `docker/docker-compose.yml` (`admin` / `password`).
- **`ECONNREFUSED 27017`** — Docker container isn't up. Run `docker compose -f docker/docker-compose.yml up -d`.
- **CORS error in the browser** — set `FRONTEND_URL` to the exact origin the frontend is served from (including the scheme and port).
- **Cookie not persisting** — verify the frontend is sending `withCredentials: true` and the backend's `FRONTEND_URL` is set; `SameSite=Lax` requires the request to come from the configured origin.
- **"Cannot find module" after adding a new file** — restart `npm run dev` so ts-node picks up the change.
