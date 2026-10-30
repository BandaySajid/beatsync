import { nanoid } from "nanoid";

const CLIENT_ID_KEY = "beatsync-client-id";
const CLIENT_SECRET_KEY = "beatsync-client-secret";

const cachedIds = new Map<string, string>();

/**
 * Get or create a value persisted in localStorage under `key`.
 * Always returns the same value for the session.
 */
function getPersistentId(key: string): string {
  // Return cached value if we already have it
  const cached = cachedIds.get(key);
  if (cached) {
    return cached;
  }

  let id: string;
  try {
    // Check if we have an existing value in localStorage
    const existing = localStorage.getItem(key);

    if (existing) {
      id = existing;
    } else {
      // Generate a new value and save it
      id = nanoid();
      localStorage.setItem(key, id);
    }
  } catch (error) {
    console.error(`Failed to access localStorage, generating non-persistent ${key}:`, error);
    // Fallback: Generate a new value but don't persist it
    // This allows the app to function, but the value won't persist across sessions/reloads
    id = nanoid();
  }

  cachedIds.set(key, id);
  return id;
}

/**
 * Get or create a persistent client ID.
 * This function can be called from anywhere (hooks, stores, etc.)
 * and will always return the same ID for the session.
 */
export function getClientId(): string {
  return getPersistentId(CLIENT_ID_KEY);
}

/**
 * Proves this browser owns its client ID. Unlike the ID, which every room member
 * sees, the secret is only ever sent to the server on connect.
 */
export function getClientSecret(): string {
  return getPersistentId(CLIENT_SECRET_KEY);
}
