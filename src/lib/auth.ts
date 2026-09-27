/** Sanctum bearer token storage — see docs/api-integration-guide.md §3. */

const TOKEN_KEY = "homesync.auth-token";

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
  window.dispatchEvent(new CustomEvent("homesync:auth"));
}

export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/** Full-page nav into the backend's server-side OAuth redirect — not a client SDK. */
export function ssoRedirectUrl(provider: "google" | "apple", apiBase: string): string {
  return `${apiBase}/auth/${provider}/redirect`;
}
