/**
 * Authentication initialization
 * 
 * Ensures the API token is available in localStorage for the API client.
 * Reads from VITE_API_SECRET environment variable and syncs to localStorage.
 */

/**
 * Initialize authentication by syncing environment variable to localStorage
 */
export function initAuth(): void {
  const envToken = import.meta.env.VITE_API_SECRET;
  
  if (envToken) {
    // Always update localStorage with the environment token
    // This ensures the token is synced even if the environment changes
    localStorage.setItem('api_token', envToken);
    console.log('[Auth] Token initialized from environment');
  } else {
    // Check if we have a token in localStorage from a previous session
    const storedToken = localStorage.getItem('api_token');
    if (!storedToken) {
      console.warn('[Auth] No API token found in environment or localStorage');
      console.warn('[Auth] API requests will fail with 401 Unauthorized');
      console.warn('[Auth] Set VITE_API_SECRET environment variable or manually set token via apiClient.setToken()');
    } else {
      console.log('[Auth] Using stored token from localStorage');
    }
  }
}

/**
 * Get the current auth token
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('api_token') || import.meta.env.VITE_API_SECRET || null;
}

/**
 * Set the auth token manually
 */
export function setAuthToken(token: string): void {
  localStorage.setItem('api_token', token);
  console.log('[Auth] Token set manually');
}

/**
 * Clear the auth token
 */
export function clearAuthToken(): void {
  localStorage.removeItem('api_token');
  console.log('[Auth] Token cleared');
}
