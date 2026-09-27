# HomeCraftApi Integration Guide

> For the agent wiring this frontend up to the real backend. The backend
> (`HomeCraftApi`, sibling repo at `../HomeCraftApi`) is built and merged —
> this doc is the frontend-side half of the work `docs/backend-api-spec.md`
> flagged as out of scope when it was written. Read `docs/backend-api-spec.md`
> first for the full data model and sync-queue behavior; this doc only covers
> what changed once a real backend existed: auth and wiring the base URL.

## What's already correct — don't touch

`src/lib/store.tsx` already calls every mutation endpoint the backend
implements, with the right method, path, and payload shape, **except** the
one item fixed in §3 below. Do not redesign the sync queue, do not add
retry logic beyond what `client.ts` already has, do not touch `types.ts` —
the backend's JSON responses are shaped to match it field-for-field.

## 1. Point the client at the real API

`src/lib/api/client.ts:11` reads `VITE_API_URL`, falling back to
`https://api.homesync.local/api` (a placeholder that always fails, which is
why the app has worked offline-only until now).

Add to `.env` (create if absent, check `.gitignore` covers it — it should,
this is a Vite env file):

```
VITE_API_URL=http://localhost/api
```

That's the Laravel Sail default (`APP_URL=http://localhost`, port 80). If
the backend is running on a different host/port, match it exactly — no
trailing slash (paths in `store.tsx` already start with `/`).

## 2. Auth: what the backend expects

**There was no auth or login UI before this.** You are adding both. The
backend supports two independent paths onto the same account:

### Email + password
- `POST /register` `{name, email, password}` → `201 {token}`
- `POST /login` `{email, password}` → `200 {token}`
- `POST /logout` (needs `Authorization: Bearer <token>`) → `204`

`/register` and `/login` are rate-limited (6/min) — a real login form should
surface a 429 as "too many attempts, try again shortly," not a generic error.

### Google / Apple SSO (server-side redirect — not a client SDK)
This is **not** Google Identity Services or Sign in with Apple JS. The
backend owns the whole OAuth dance:

1. Frontend navigates the browser (full page nav, not `fetch`) to:
   - `GET {API_BASE}/auth/google/redirect`
   - `GET {API_BASE}/auth/apple/redirect`
2. User authenticates with the provider.
3. Backend's callback creates/finds the user and **302-redirects the browser
   to `{FRONTEND_URL}/auth/callback?token=<sanctum-token>`** — or, on
   failure, to `{FRONTEND_URL}/auth/callback?error=<code>` (`sso_failed` or
   `email_conflict`; `email_conflict` means an account with that email
   already has a password and an unverified email address — the backend
   deliberately refuses to auto-link in that case to prevent account
   takeover, so show a message telling the user to log in with their
   password instead).

So: `Sign in with Google` / `Sign in with Apple` buttons are plain
`<a href="{API_BASE}/auth/google/redirect">` links (or
`window.location.href = ...`), not JS SDK calls.

**Backend also needs `FRONTEND_URL` in its own `.env`** pointed at
wherever this frontend is actually served (dev: probably
`http://localhost:5173`) — that's a backend-repo config change, not
something to fix here, but if the redirect lands on the wrong origin
during testing, that's why.

### The `/auth/callback` route this frontend needs (new)

Add a route (TanStack Router — see `src/routes/`, follow the existing
file-based convention, e.g. `src/routes/auth.callback.tsx`) that:

1. Reads `token` or `error` from the URL query string.
2. On `token`: store it (see §3), then redirect to `/` (or wherever the
   app's home route is) — do not leave the token sitting in the URL bar or
   browser history any longer than necessary; replace the history entry
   (`router.navigate({ to: "/", replace: true })` or equivalent) rather than
   pushing a new one.
3. On `error`: show a short message (`sso_failed` → "sign-in failed, try
   again"; `email_conflict` → "an account with this email already exists —
   log in with your password") and a link back to the login screen.

This token-in-query-string handoff is a deliberate, documented tradeoff in
the backend's design (accepted for a single-household MVP) — not a bug to
"fix" by changing the flow.

## 3. Storing and sending the token

There is currently **no token storage and no `Authorization` header
anywhere in this codebase.** Add both:

1. Pick a storage location — `localStorage` is consistent with how
   `store.tsx` already persists app state (`STORAGE_KEY` in `store.tsx:14`).
   A reasonable key: `homesync.auth-token`.
2. In `client.ts`, every `fetch` call currently sends only
   `{ "Content-Type": "application/json", Accept: "application/json" }`
   (mutations, `client.ts:89`) or `{ Accept: "application/json" }` (GETs,
   `client.ts:109`). Add `Authorization: Bearer <token>` to both, reading
   the token from wherever you stored it in step 1. If there's no token
   (logged out), the request should still be attempted — the backend
   returns `401`, and see the next point for what to do with that.
3. **Handle `401` specifically.** Right now `apiGet` treats any non-ok
   response the same as offline (returns `fallback`), and `flushQueue`
   treats any `4xx` as dead-letter-and-move-on (`client.ts:93-94`). A `401`
   means the token is missing/expired/revoked — on `401`, clear the stored
   token and redirect to the login screen instead of silently falling back
   or dead-lettering the request forever. Don't change the `4xx`
   dead-letter behavior for anything else; only special-case `401`.

## 4. The one endpoint-shape fix already applied server-side

`docs/backend-api-spec.md §3` flagged that `logTask()` in `store.tsx:90-98`
sends `POST /maintenance-logs` with `{task_id, logged_at}` and no `id`,
even though the client generates one. **The backend was fixed to make `id`
optional and generate its own when absent** — you do not need to change
`store.tsx` to add the missing `id` to that call. No frontend change needed
for this one; noted here only so you don't "fix" it a second time.

## 5. Endpoints reference (implemented, matches `docs/backend-api-spec.md` §4 plus auth)

All paths relative to `VITE_API_URL`. Every route below except `/register`,
`/login`, and the four `/auth/{provider}/*` routes requires the
`Authorization` header from §3.

| Method | Path | Notes |
|---|---|---|
| POST | `/register` | `{name, email, password}` → `{token}`, 201. Rate-limited. |
| POST | `/login` | `{email, password}` → `{token}`, 200. Rate-limited. |
| POST | `/logout` | No body. 204. |
| GET | `/auth/google/redirect` | Full-page nav, not fetch. |
| GET | `/auth/google/callback` | Backend-only; never called directly by the frontend. |
| GET | `/auth/apple/redirect` | Full-page nav, not fetch. |
| POST | `/auth/apple/callback` | Backend-only (Apple's `form_post`); never called by the frontend. |
| GET/POST | `/maintenance-tasks` | Matches `store.tsx` `addTask`/list already. |
| DELETE | `/maintenance-tasks/{id}` | Matches `removeTask`. |
| GET/POST | `/maintenance-logs` | Matches `logTask`/list — `id` optional on POST, see §4. |
| GET/POST | `/recipes` | Matches `addRecipe`/list. |
| GET | `/shopping-items` | Not currently called by `store.tsx` — available if you wire a hydration/sync call later (see `docs/backend-api-spec.md §6.2`, still an open gap, out of scope here). |
| POST | `/shopping-items/batch` | Matches `addShoppingItems`. |
| PATCH | `/shopping-items/{id}/toggle` | Matches `toggleShoppingItem`. |
| PATCH | `/shopping-items/{id}` | Matches `dismissWarning` (and any other partial update). |
| DELETE | `/shopping-items/{id}` | Matches `removeShoppingItem`. |
| GET | `/purchases` | Not currently called — same as shopping-items GET, future hydration work. |
| POST | `/receipts/process` | Matches `completePurchase`. Persists only — no OCR. |

## 6. Verification checklist

After wiring the above, confirm end-to-end against a running backend
(`cd ../HomeCraftApi && composer run dev` or Sail):

- [ ] Register a new account through the new login UI, confirm a token is
      stored and subsequent requests carry it.
- [ ] Log out, confirm the token is cleared and a subsequent mutating
      action doesn't silently no-op (it should redirect to login on 401).
- [ ] Click "Sign in with Google" (or Apple), complete the OAuth flow in a
      real browser (mocking won't exercise this path), land back on
      `/auth/callback`, confirm token capture and redirect to the app.
- [ ] Trigger the `email_conflict` path deliberately (register with
      password using an email, then try Google SSO with the same email)
      and confirm the error message renders sensibly, not a raw query
      string.
- [ ] Mark a maintenance task done (`logTask`), confirm the request
      actually reaches the backend now (previously always 422'd — see §4)
      and doesn't land in the dead-letter queue
      (`readFailedQueue()` in devtools should stay empty for this action).
- [ ] Go offline (devtools network throttling), perform a few mutations,
      go back online, confirm the queue flushes and everything appears in
      the backend (`GET /maintenance-tasks` etc. via curl/Postman, since
      the frontend itself doesn't call those GETs yet).
