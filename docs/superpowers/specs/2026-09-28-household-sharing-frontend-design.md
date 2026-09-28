# Household sharing — frontend design

## Context

`HomeCraftApi` (sibling repo, `../HomeCraftApi`) shipped household sharing —
see its `docs/superpowers/specs/2026-09-28-household-sharing-design.md`.
Multiple users can now co-own the same household's data via a one-time
share code, with a profile-completion gate on writes and a household
activity log. None of this exists on the frontend yet: no `/join` route, no
account/household screen, no profile-completion handling, no activity log
UI, no way to reach a share code from the login screen.

This doc is the frontend-side half of that work, in the same spirit as
`docs/api-integration-guide.md` (which covered the original auth wiring).

## New backend surface (already implemented, this doc consumes it)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/join` | public, throttled 6/min | `{share_code, email, password}` → `{token}`. No `name`. Invalid/reused code → `422` (generic, no enumeration). |
| `PATCH` | `/profile` | sanctum | `{name}` → sets the caller's name. |
| `GET` | `/household` | sanctum | `{id, members: [{id, name, is_owner}], share_code}`. `share_code` is `null` unless the caller is the owner. |
| `POST` | `/household/share-code` | sanctum, owner-only | Regenerates the code (invalidates any unredeemed one). `403` for non-owners. |
| `GET` | `/household/activity` | sanctum | Paginated (`latest()`). `{id, actor_name, action, subject_type, subject_label, created_at}` per row. |

Every write (`POST`/`PATCH`/`DELETE`) on the 6 domain resources now 422s
with a distinct `profile_incomplete` error code if the caller's `name` is
null (share-code joiners start with no name).

## Goals

- A user can join an existing household with a share code instead of
  registering a fresh, empty account.
- A joiner is prompted for their name the moment they try to write
  something (not before — they can browse immediately), then that write
  proceeds automatically.
- Users can see who's in their household, and the owner can see/copy/
  regenerate the share code to invite someone.
- Users can see a log of who changed what in the household.

## Non-goals (mirrors the backend spec's non-goals)

- Merging an existing account into another household.
- SSO + share code together.
- Removing a member, leaving a household, renaming/transferring ownership.
- Per-member permission tiers — every member has full read/write, this is
  UI-transparent (no "role" concept to render beyond owner-vs-not for the
  share code visibility).

## A. Types & API client

`src/lib/api/types.ts` — add:

```ts
export interface HouseholdMember {
  id: number;
  name: string | null;
  is_owner: boolean;
}

export interface Household {
  id: string;
  members: HouseholdMember[];
  share_code: string | null;
}

export interface ActivityLogEntry {
  id: string;
  actor_name: string;
  action: "created" | "updated" | "deleted";
  subject_type: string;
  subject_label: string;
  created_at: string;
}
```

`src/lib/api/client.ts` — add:

- `apiJoin(body: {share_code, email, password})` — same shape as the
  existing `apiAuth`, hitting `/join`.
- `apiProfile(name: string)` — `PATCH /profile`, called synchronously
  (awaited directly by the caller, not pushed through `enqueue()` — this
  one has to complete before the gated action proceeds, and its response
  body matters, unlike the fire-and-forget domain mutations).
- `GET /household` and `GET /household/activity` — plain `apiGet` calls
  (paginate `/household/activity` with `?page=`).
- `POST /household/share-code` — synchronous `fetch`-and-await like
  `apiProfile` (the UI needs the new code back immediately to display it).

## B. Join flow

- New route `src/routes/join.tsx`, structurally mirroring `login.tsx`:
  fields `share_code`, `email`, `password` (no name field). On success:
  `setAuthToken(token)`, set `localStorage["homesync.profile-complete"] =
  "false"`, navigate to `/`.
- Add `/join` to `PUBLIC_ROUTES` in `src/routes/__root.tsx`.
- `login.tsx`: small link under the form, "Masz kod zaproszenia? Dołącz" →
  `/join`.
- Error handling: `422` on `/join` → generic "Nieprawidłowy lub użyty kod
  zaproszenia." (matches backend's deliberate non-enumeration). `429` →
  same rate-limit message pattern already used on `/login`.

## C. Profile-completion gate

**Local flag**, `src/lib/auth.ts`: `getProfileComplete()` /
`setProfileComplete(bool)`, backed by `localStorage["homesync.profile-
complete"]`. Defaults to `true` when absent (covers existing users and
fresh registers/SSO, who always have a name already). Set `false` only
right after a successful `/join`. Set `true` after a successful `PATCH
/profile`.

**Gate mechanism**: a shared `<CompleteProfileModal>` component
(`src/components/CompleteProfileModal.tsx`) with a single name input.
`store.tsx`'s mutation functions (`addTask`, `logTask`, `addRecipe`,
`addShoppingItems`, `toggleShoppingItem`, `dismissWarning`,
`removeShoppingItem`, `completePurchase`, `removeTask`, and the tin
mutations) each currently apply local state then call `enqueue(...)`.
Wrap the entry points that trigger these (not `store.tsx` itself, which
stays UI-agnostic) at the UI layer: a `useProfileGate()` hook that exposes
`runGated(action: () => void)`. Call sites that invoke a mutating store
function route through `runGated` instead of calling it directly. If
`getProfileComplete()` is `false`, `runGated` opens the modal instead of
invoking `action`; on modal submit, `apiProfile(name)` is awaited,
`setProfileComplete(true)`, then `action()` runs.

This means editing every call site that performs a domain write to go
through `runGated`. That's a broad but mechanical change — acceptable
since it's the only correct place to intercept (the alternative, gating
inside `store.tsx`, would make the offline-first store aware of an
account-status concern it doesn't otherwise carry).

**Defensive fallback** in `client.ts`'s `flushQueue`: today any `4xx`
response is dead-lettered unconditionally (`recordFailed`). Add one
special case — if the response body's error code is `profile_incomplete`,
don't dead-letter: call `setProfileComplete(false)` (so the next gated
action surfaces the modal) and `break` out of the flush loop instead of
advancing past the request, so it stays in the retry queue and re-sends
once the name is set. This only fires if the proactive flag in C ever
drifts from server truth (e.g. two tabs); it's not the primary path.

## D. Account screen

- Header icon (top of the `/` / Dom route) → `Link to="/account"`.
- New route `src/routes/account.tsx`, three sections on one page:
  - **Profil** — current name (from the caller's own entry in `GET
    /household`'s `members`, matched by... the response doesn't include
    "which member is me." Simplest fix: `PATCH /profile`'s response
    returns the updated user, and this screen doesn't need someone else's
    identity — track "my name" locally too, alongside the token, set at
    login/register/join time when known and updated whenever `PATCH
    /profile` succeeds. Add `getMyName()`/`setMyName()` next to
    `getProfileComplete()` in `auth.ts`. Register/login flows don't
    currently get a name back from the API (`/login` returns only
    `{token}`) — for login, leave `myName` unset until the account screen
    itself first loads `GET /household` and reconciles by finding the
    member whose `is_owner` matches... still ambiguous with 2+ owners-only
    households. Pragmatic resolution: add "my id" isn't returned either.
    **Given the backend doesn't expose "who am I" distinctly from the
    members list, the Profil section's name field is edit-only** (a plain
    input pre-filled from local `getMyName()` if we have it, blank
    otherwise) rather than round-tripped for display accuracy — saving
    always calls `PATCH /profile` and updates the local copy. This is a
    known minor gap (display staleness across devices), not a functional
    one.
  - **Domownicy** — full `members` list from `GET /household` (name or
    "Bez imienia" placeholder for a joiner who hasn't set one yet, badge
    for `is_owner`). If `is_owner` for the current session (inferred: the
    request succeeds and a share code comes back non-null, OR simpler —
    just attempt `POST /household/share-code`-gated UI: show the share
    code block only when `GET /household`'s `share_code` field is
    non-null *or* a "Wygeneruj kod" button that, on `403`, hides itself
    permanently for the session). Copy-to-clipboard button on the code.
    "Nowy kod" button calls `POST /household/share-code`, replaces the
    displayed code.
  - **Aktywność** — `GET /household/activity`, rendered as a simple list
    (actor name + verb by action + subject_label + relative time).
    "Załaduj więcej" button appends the next page.
  - **Wyloguj** button at the bottom (moved from the tab bar).
- `__root.tsx`: remove the logout button from `TabBar`; tab bar keeps its
  4 existing tabs plus the header profile icon (icon can live in a small
  top bar rendered above `<Outlet />`, not in `TabBar` itself, since
  `TabBar` is bottom-fixed).

## E. Testing (manual QA checklist — no existing test harness for this class of flow)

- [ ] `/join` with a valid code from a real owner → account created, no
      name prompt yet, browsing (`GET`s) works immediately.
- [ ] That joiner's first write (e.g. add a shopping item) → modal
      appears, name submitted, `PATCH /profile` succeeds, the original
      add actually goes through afterward (not silently dropped).
- [ ] `/join` with an invalid or already-redeemed code → generic error,
      no account created, no token stored.
- [ ] Owner's `/account` shows the active share code; regenerating shows
      a new one and the old one no longer works on `/join`.
- [ ] Non-owner's `/account` never renders a share code or "Nowy kod"
      control.
- [ ] `/account`'s Domownicy list shows both members after a join.
- [ ] Aktywność shows a new entry after a mutation (create/update/delete)
      with the correct actor name; "Załaduj więcej" fetches the next
      page.
- [ ] Logout only reachable from `/account`, still clears the token and
      redirects to `/login`.

## Rejected alternatives

- **Gate inside `store.tsx`** — rejected: couples the offline-first store
  to an account-completeness concern; `store.tsx` should stay unaware of
  auth/session state per its existing design.
- **Redirect to a dedicated `/profile-setup` route instead of a modal** —
  rejected per explicit product decision: a modal-on-the-spot with
  auto-retry keeps the joiner's original action intact instead of making
  them redo it.
- **Reactive-only gate (catch the 422 from the queue, no proactive
  flag)** — rejected: the queue is fire-and-forget and detached from the
  UI that triggered it, so there's no clean place to show a blocking
  modal and retry *the original in-flight action* from inside
  `flushQueue`. The proactive local flag, checked before the action ever
  reaches the queue, is what makes the "auto-retry after modal" UX
  possible at all; the queue-side check is a fallback only.

## Open questions

- "My name" display accuracy across devices/sessions (see Profil section
  above) — acceptable gap for v1, flagged rather than solved, since the
  backend has no "who am I" endpoint distinct from the members list.
