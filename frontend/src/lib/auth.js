import { apiUrl } from './api';

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
  const response = await fetch(apiUrl(path), fetchOptions);

  if (response.status === 401) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return response;
};
