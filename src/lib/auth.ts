/** Sanctum bearer token storage — see docs/api-integration-guide.md §3. */

const TOKEN_KEY = "homesync.auth-token";
const PROFILE_COMPLETE_KEY = "homesync.profile-complete";
const MY_NAME_KEY = "homesync.my-name";
const IS_OWNER_KEY = "homesync.is-owner";

function isBrowser() {
  return typeof window !== "undefined";
}

export function getAuthToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  if (!isBrowser()) return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new CustomEvent("homesync:auth"));
}

export function clearAuthToken() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(PROFILE_COMPLETE_KEY);
  window.localStorage.removeItem(MY_NAME_KEY);
  window.localStorage.removeItem(IS_OWNER_KEY);
  window.dispatchEvent(new CustomEvent("homesync:auth"));
}

export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/**
 * Whether the current account has a name set server-side. Defaults to
 * `true` (existing users, fresh register/SSO accounts always have a name
 * already) — only `/join` (share-code signup) sets this `false`, since a
 * joiner has no name until they complete PATCH /profile. See
 * docs/superpowers/specs/2026-09-28-household-sharing-frontend-design.md §C.
 */
export function getProfileComplete(): boolean {
  if (!isBrowser()) return true;
  return window.localStorage.getItem(PROFILE_COMPLETE_KEY) !== "false";
}

export function setProfileComplete(complete: boolean) {
  if (!isBrowser()) return;
  window.localStorage.setItem(PROFILE_COMPLETE_KEY, complete ? "true" : "false");
}

/** Local cache of "my name" for prefill only — the backend has no "who am I"
 * endpoint distinct from the household members list, so this is best-effort
 * and can go stale across devices. See design doc's Open Questions. */
export function getMyName(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(MY_NAME_KEY);
}

export function setMyName(name: string) {
  if (!isBrowser()) return;
  window.localStorage.setItem(MY_NAME_KEY, name);
}

/**
 * Whether this account owns its household. Defaults to `true` — register,
 * SSO, and every pre-existing account always own their household (per the
 * backend's design: registration/SSO always creates a new owned household,
 * and the migration backfill made every existing user the owner of their
 * own solo household). Only `/join` ever sets this `false`, since joining
 * via share code is the sole way to become a non-owner member. The backend
 * has no "who am I" endpoint to double-check this against post-login, so
 * this is a client-side inference, not a fetched fact — see the account
 * screen's use of it, which still treats a 403 on regenerate as the
 * authoritative correction if this ever drifts.
 */
export function getIsOwner(): boolean {
  if (!isBrowser()) return true;
  return window.localStorage.getItem(IS_OWNER_KEY) !== "false";
}

export function setIsOwner(isOwner: boolean) {
  if (!isBrowser()) return;
  window.localStorage.setItem(IS_OWNER_KEY, isOwner ? "true" : "false");
}

/** Full-page nav into the backend's server-side OAuth redirect — not a client SDK. */
export function ssoRedirectUrl(provider: "google" | "apple", apiBase: string): string {
  return `${apiBase}/auth/${provider}/redirect`;
}
