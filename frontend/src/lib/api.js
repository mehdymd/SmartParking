const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

const apiBase = trimTrailingSlash(process.env.REACT_APP_API_BASE || '');
const wsBase = trimTrailingSlash(process.env.REACT_APP_WS_BASE || '');

const normalizePath = (path = '') => (path.startsWith('/') ? path : `/${path}`);

export const apiUrl = (path = '') => {
  const normalizedPath = normalizePath(path);
  return apiBase ? `${apiBase}${normalizedPath}` : normalizedPath;
};

export const wsUrl = (path = '') => {
  const normalizedPath = normalizePath(path);

  if (wsBase) {
      return `${wsBase}${normalizedPath}`;
  }

  if (apiBase) {
    return `${apiBase.replace(/^http/i, 'ws')}${normalizedPath}`;
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${normalizedPath}`;
  }

  return normalizedPath;
};
