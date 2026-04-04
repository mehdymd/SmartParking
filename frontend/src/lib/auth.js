import { apiCandidates, apiUrl } from './api';

const STORAGE_KEY = 'smartparking.auth';

export const loadAuth = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveAuth = (auth) => {
  try {
    if (!auth) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch {}
};

export const authHeaders = (token) => (
  token ? { Authorization: `Bearer ${token}` } : {}
);

export const authFetch = async (path, options = {}, token) => {
  const fetchOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...authHeaders(token),
    },
  };
  if (options.body && typeof options.body === 'object') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const candidates = apiCandidates(path);
  const fallbackCandidates = candidates.length ? candidates : [apiUrl(path)];
  let lastResponse = null;
  let lastError = null;

  for (const candidate of fallbackCandidates) {
    try {
      const response = await fetch(candidate, fetchOptions);

      if (response.status === 401) {
        const error = new Error('Unauthorized');
        error.status = 401;
        throw error;
      }

      if (response.status === 404 && candidate !== fallbackCandidates[fallbackCandidates.length - 1]) {
        lastResponse = response;
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (error?.status === 401) {
        throw error;
      }
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error('Failed to fetch');
};
