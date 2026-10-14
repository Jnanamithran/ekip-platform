const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
    console.error(
        "VITE_API_URL is not set — add it to apps/frontend/.env (see .env.example)."
    );
}

const REFRESH_KEY = "ekip_refresh_token";

// Access token lives ONLY in memory (module-scope variable) — never
// localStorage, never React state. It's expected to vanish on reload;
// restoreSession() below is what rebuilds it from the refresh token.
let accessToken = null;

export function getRefreshToken() {
    return localStorage.getItem(REFRESH_KEY);
}

function setTokens({ access_token, refresh_token }) {
    accessToken = access_token;
    if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
}

function clearTokens() {
    accessToken = null;
    localStorage.removeItem(REFRESH_KEY);
}

async function parseJsonSafe(res) {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

// Only one refresh call may be in flight at a time (contract rule #4) —
// every caller that hits this while a refresh is already running awaits
// the SAME promise instead of firing a second one.
let refreshPromise = null;

async function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;

    const refresh_token = getRefreshToken();
    if (!refresh_token) {
        clearTokens();
        throw new Error("No refresh token available");
    }

    refreshPromise = (async () => {
        const res = await fetch(`${API_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token }),
        });

        if (!res.ok) {
            clearTokens();
            throw new Error("Session expired — please log in again.");
        }

        const data = await res.json();
        // The old refresh token is now dead (single-use) — this MUST
        // replace it, or the next refresh attempt fails.
        setTokens(data);
        return data.access_token;
    })();

    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

/**
 * Fetch wrapper for every protected call. On a 401, refreshes once and
 * retries the original request once — never more than one retry.
 */
export async function apiFetch(path, options = {}) {
    const doFetch = (token) =>
        fetch(`${API_URL}${path}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...options.headers,
            },
        });

    let res = await doFetch(accessToken);

    if (res.status === 401 && path !== "/auth/refresh") {
        const newToken = await refreshAccessToken(); // throws if refresh fails
        res = await doFetch(newToken);
    }

    const data = await parseJsonSafe(res);
    if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
    }
    return data;
}

export async function login(email, password) {
    const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data?.error ?? "Login failed");
    setTokens(data);
    return data;
}

export async function logout() {
    const refresh_token = getRefreshToken();
    clearTokens();
    if (!refresh_token) return;
    try {
        await fetch(`${API_URL}/auth/logout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token }),
        });
    } catch {
        // Tokens are already cleared client-side; a failed server-side
        // logout call isn't worth blocking the UI on.
    }
}

export async function getMe() {
    const data = await apiFetch("/auth/me");
    return data.user;
}

// Called once on app load if a refresh token already exists in
// localStorage — rebuilds the in-memory access token, then fetches
// who the user is, so a page reload doesn't force a re-login.
export async function restoreSession() {
    await refreshAccessToken();
    return getMe();
}

export async function registerOrganization(payload) {
    const res = await fetch(`${API_URL}/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data?.error ?? "Could not create organization");
    return data;
}