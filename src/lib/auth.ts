/** Sanctum bearer token storage — see docs/api-integration-guide.md §3. */

const TOKEN_KEY = "homesync.auth-token";
const PROFILE_COMPLETE_KEY = "homesync.profile-complete";
const MY_NAME_KEY = "homesync.my-name";

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

/** Full-page nav into the backend's server-side OAuth redirect — not a client SDK. */
export function ssoRedirectUrl(provider: "google" | "apple", apiBase: string): string {
  return `${apiBase}/auth/${provider}/redirect`;
}
