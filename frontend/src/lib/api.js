const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');
const hasWindow = typeof window !== 'undefined';
const isAbsoluteUrl = (value = '') => /^[a-z][a-z\d+.-]*:\/\//i.test(value);
const wsProtocolFor = (protocol = 'http:') => (protocol === 'https:' || protocol === 'wss:' ? 'wss:' : 'ws:');

const apiBase = trimTrailingSlash(process.env.REACT_APP_API_BASE || '');
const wsBase = trimTrailingSlash(process.env.REACT_APP_WS_BASE || '');
const isDevelopment = process.env.NODE_ENV === 'development';
const browserHost = 'localhost';
const devApiBase = `http://${browserHost}:8001`;
const devWsBase = `ws://${browserHost}:8001`;

const normalizePath = (path = '') => (path.startsWith('/') ? path : `/${path}`);
const unique = (items = []) => Array.from(new Set(items.filter(Boolean)));

const resolveBase = (base = '') => {
  if (!base) return '';
  if (isAbsoluteUrl(base) || !hasWindow) {
    return trimTrailingSlash(base);
  }
  return trimTrailingSlash(new URL(base, window.location.origin).toString());
};

const resolveWsBase = (base = '') => {
  const resolved = resolveBase(base);
  if (!resolved || !isAbsoluteUrl(resolved)) {
    return resolved;
  }

  const url = new URL(resolved);
  url.protocol = wsProtocolFor(url.protocol || window.location.protocol);
  return trimTrailingSlash(url.toString());
};

const toWsBaseFromHttp = (base = '') => {
  const resolved = resolveBase(base);
  if (!resolved || !isAbsoluteUrl(resolved)) {
    return resolved;
  }

  const url = new URL(resolved);
  url.protocol = wsProtocolFor(url.protocol);
  return trimTrailingSlash(url.toString());
};

export const apiUrl = (path = '') => {
  const normalizedPath = normalizePath(path);
  if (apiBase) {
    return `${apiBase}${normalizedPath}`;
  }
  if (isDevelopment) {
    return `${devApiBase}${normalizedPath}`;
  }
  return normalizedPath;
};

export const apiCandidates = (path = '') => {
  const normalizedPath = normalizePath(path);
  const candidates = [];

  const addBase = (base = '') => {
    const resolved = resolveBase(base);
    if (!resolved) return;
    candidates.push(`${resolved}${normalizedPath}`);
  };

  if (apiBase) {
    addBase(apiBase);
  }

  if (isDevelopment) {
    addBase(devApiBase);
    addBase('http://127.0.0.1:8000');
    addBase('http://localhost:8000');
    addBase('http://127.0.0.1:8001');
    addBase('http://localhost:8001');
  }

  if (hasWindow) {
    const current = new URL(window.location.origin);
    candidates.push(`${trimTrailingSlash(current.toString())}${normalizedPath}`);

    const hostVariants = unique([
      current.hostname,
      '127.0.0.1',
      'localhost',
      current.hostname === 'localhost' ? '127.0.0.1' : null,
      current.hostname === '127.0.0.1' ? 'localhost' : null,
    ]);
    const portVariants = unique([current.port, '8000', '8001']);

    hostVariants.forEach((hostname) => {
      portVariants.forEach((port) => {
        if (!hostname || !port) return;
        candidates.push(`${current.protocol}//${hostname}:${port}${normalizedPath}`);
      });
    });
  }

  candidates.push(normalizedPath);
  return unique(candidates);
};

export const qrCodeUrl = (data = '', size = 240) => {
  const payload = typeof data === 'string' ? data.trim() : String(data || '').trim();
  if (!payload) {
    return '';
  }

  const params = new URLSearchParams({
    data: payload,
    size: String(size || 240),
  });
  return apiUrl(`/public/qr-code?${params.toString()}`);
};

export const qrCodeCandidates = (data = '', size = 240) => {
  const payload = typeof data === 'string' ? data.trim() : String(data || '').trim();
  if (!payload) {
    return [];
  }

  const params = new URLSearchParams({
    data: payload,
    size: String(size || 240),
  });
  return apiCandidates(`/public/qr-code?${params.toString()}`);
};

export const wsCandidates = (path = '') => {
  const normalizedPath = normalizePath(path);
  const candidates = [];

  const addCandidate = (base = '') => {
    if (!base) return;
    const candidate = `${base}${normalizedPath}`;
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (wsBase) {
    addCandidate(resolveWsBase(wsBase));
  }

  if (apiBase) {
    addCandidate(toWsBaseFromHttp(apiBase));
  }

  if (isDevelopment) {
    addCandidate(resolveWsBase(devWsBase));
  }

  if (hasWindow) {
    const currentOrigin = new URL(window.location.origin);
    currentOrigin.protocol = wsProtocolFor(window.location.protocol);
    addCandidate(trimTrailingSlash(currentOrigin.toString()));
  }

  return candidates;
};

export const wsUrl = (path = '') => {
  return wsCandidates(path)[0] || normalizePath(path);
};

const getStoredToken = () => {
  try {
    return localStorage.getItem('mobile_token');
  } catch {
    return null;
  }
};

const setStoredToken = (token) => {
  try {
    if (token) {
      localStorage.setItem('mobile_token', token);
    } else {
      localStorage.removeItem('mobile_token');
    }
  } catch {}
};

const getStoredUser = () => {
  try {
    const stored = localStorage.getItem('mobile_user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

const setStoredUser = (user) => {
  try {
    if (user) {
      localStorage.setItem('mobile_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('mobile_user');
    }
  } catch {}
};

export const mobileAuth = {
  sendOTP: async (phone) => {
    console.log('[DEBUG] sendOTP called with phone:', phone);
    try {
      const response = await fetch(apiUrl('/public/auth/send-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      console.log('[DEBUG] sendOTP response status:', response.status);
      const payload = await response.json();
      console.log('[DEBUG] sendOTP payload:', payload);
      if (!response.ok) throw new Error(payload.detail || 'Failed to send OTP');
      return payload;
    } catch (err) {
      console.error('[DEBUG] sendOTP network error:', err);
      if (err.message === 'Failed to fetch' || err.message.includes('network')) {
        throw new Error('Cannot connect to server. Make sure backend is running on port 8000.');
      }
      throw err;
    }
  },

  login: async (phone, otp) => {
    console.log('[DEBUG] login called with phone:', phone, 'otp:', otp);
    try {
      const response = await fetch(apiUrl('/public/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });
      console.log('[DEBUG] login response status:', response.status);
      const payload = await response.json();
      console.log('[DEBUG] login payload:', payload);
      if (!response.ok) throw new Error(payload.detail || 'Login failed');
      
      setStoredToken(payload.token);
      setStoredUser(payload.user);
      return payload;
    } catch (err) {
      console.error('[DEBUG] login network error:', err);
      if (err.message === 'Failed to fetch' || err.message.includes('network')) {
        throw new Error('Cannot connect to server. Make sure backend is running on port 8000.');
      }
      throw err;
    }
  },

  logout: () => {
    setStoredToken(null);
    setStoredUser(null);
  },

  getToken: getStoredToken,

  getUser: getStoredUser,

  isAuthenticated: () => {
    return !!getStoredToken() && !!getStoredUser();
  },

  fetchWithAuth: async (url, options = {}) => {
    const token = getStoredToken();
    if (!token) throw new Error('Not authenticated');
    
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  },
};
