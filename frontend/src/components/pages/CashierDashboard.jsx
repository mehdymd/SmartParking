import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  Bug,
  Camera,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  CreditCard,
  Download,
  FileText,
  HelpCircle,
  History,
  Keyboard,
  LifeBuoy,
  LogOut,
  Moon,
  PauseCircle,
  PlayCircle,
  Receipt,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Sun,
  TriangleAlert,
  User,
  Wallet,
  X,
} from 'lucide-react';
import jsQR from 'jsqr';
import { apiUrl } from '../../lib/api';
import { authFetch } from '../../lib/auth';
import './CashierDashboard.css';

const storageKey = (scope, username = 'cashier') => `smartparking.cashier.${scope}.${username}`;

const DEFAULT_PREFERENCES = {
  theme: 'dark',
  language: 'English',
  fontScale: 'normal',
  currency: 'USD',
  notificationsEnabled: true,
  soundEnabled: false,
  scannerSensitivity: 'balanced',
};

const BREAK_DURATION_SECONDS = 15 * 60;

const SHORTCUTS = [
  ['Ctrl+Q', 'Focus QR input'],
  ['Ctrl+P', 'Focus plate input'],
  ['Ctrl+S', 'Search reservation'],
  ['Ctrl+R', 'Open scanner'],
  ['Ctrl+N', 'Open payment modal'],
  ['Ctrl+?', 'Show shortcuts'],
  ['Esc', 'Close modal or menu'],
];

const FAQ_ITEMS = [
  {
    question: 'How can I search the reservation fastest?',
    answer: 'Paste the scanned QR payload, type the reservation code, or search by plate. The cashier lookup accepts both direct codes and QR payloads.',
  },
  {
    question: 'What happens when I mark a reservation paid?',
    answer: 'The payment status is updated on the reservation and the cashier transaction list reloads from the linked payment endpoints.',
  },
  {
    question: 'Why does the session continue after refresh?',
    answer: 'The cashier session is stored locally and keeps running until the cashier explicitly ends it from the desk header.',
  },
];

const QUICK_START_STEPS = [
  'Scan or paste the reservation QR, or search by license plate.',
  'Review customer details, reservation status, and amount due.',
  'Open the payment modal to record cash, card, or mobile settlement.',
  'Use the transaction desk to print receipts, review activity, and reload reservations.',
];

const DOC_SECTIONS = [
  {
    title: 'Reservation Lookup',
    body: 'Use the QR field for scanned payloads, reservation URLs, legacy parking QR values, or direct confirmation codes. Plate lookup remains available as a cashier fallback.',
  },
  {
    title: 'Cashier Payment Desk',
    body: 'Search the reservation, confirm the amount due, select the payment method, and record the amount received. The desk updates the reservation and linked cashier transaction records.',
  },
  {
    title: 'Session Control',
    body: 'The cashier session persists across refresh and browser reload. Use End Session when the shift closes or the cashier leaves the desk.',
  },
];

const SUPPORT_LINKS = [
  { id: 'guide', label: 'Quick Start Guide', icon: BookOpen },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'support', label: 'Contact Support', icon: LifeBuoy },
  { id: 'docs', label: 'Documentation', icon: FileText },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'mobile', label: 'Mobile' },
];

const readStored = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeStored = (key, value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const formatClock = (seconds = 0) => {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const formatDateTime = (value, fallback = 'Not available') => {
  if (!value) return fallback;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return fallback;
  }
};

const formatMoney = (amount, currency = 'USD') => {
  const symbol = String(currency || 'USD').toUpperCase() === 'USD' ? '$' : '¥';
  return `${symbol}${Number(amount || 0).toFixed(2)}`;
};

const normalizePlate = (value = '') => value.toUpperCase().replace(/[^A-Z0-9-]/g, '');

const extractConfirmationCode = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toUpperCase().startsWith('PARKING:')) {
    return raw.slice(raw.indexOf(':') + 1).split('|')[0].trim().toUpperCase();
  }
  if (raw.toUpperCase().startsWith('SPARKRES:')) {
    const token = raw.slice(raw.indexOf(':') + 1).trim();
    const parts = token.split(':');
    if (parts.length >= 3 && /^RES-[A-Z0-9]+$/i.test(parts[1] || '')) {
      return parts[1].trim().toUpperCase();
    }
    const embeddedCode = token.match(/RES-[A-Z0-9]+/i);
    return embeddedCode ? embeddedCode[0].toUpperCase() : '';
  }
  if (raw.startsWith('reservation_qr.') || /^https?:\/\//i.test(raw)) {
    const embeddedCode = raw.match(/RES-[A-Z0-9]+/i);
    return embeddedCode ? embeddedCode[0].toUpperCase() : '';
  }
  const explicitCode = raw.match(/RES-[A-Z0-9]+/i);
  return explicitCode ? explicitCode[0].toUpperCase() : raw.toUpperCase();
};

const buildLookupQuery = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (
    raw.toUpperCase().startsWith('PARKING:')
    || raw.toUpperCase().startsWith('SPARKRES:')
    || raw.startsWith('reservation_qr.')
    || /^https?:\/\//i.test(raw)
  ) {
    return raw;
  }
  return extractConfirmationCode(raw) || raw.toUpperCase();
};

const reservationToneClass = (status = '') => {
  const normalized = String(status || '').toLowerCase();
  if (['confirmed', 'active', 'checked_in', 'in_use', 'completed'].includes(normalized)) return 'success';
  if (['expired', 'cancelled', 'failed'].includes(normalized)) return 'danger';
  return 'warning';
};

const paymentToneClass = (status = '') => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'paid' || normalized === 'completed') return 'success';
  if (['failed', 'voided', 'expired'].includes(normalized)) return 'danger';
  return 'warning';
};

const buildAlertNotifications = (alerts = []) => alerts.map((alert) => ({
  id: `alert-${alert.id}`,
  title: String(alert.alert_type || 'System alert').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
  description: alert.slot_id ? `Slot ${alert.slot_id}` : (alert.detail || 'Attention required'),
  timestamp: alert.timestamp,
  severity: alert.resolved ? 'resolved' : 'high',
  type: 'system',
}));

const normalizeTransaction = (payment = {}) => {
  const reservation = payment.reservation || {};
  const metadata = payment.metadata || {};
  return {
    ...payment,
    id: payment.id || `${payment.confirmation_code || payment.reservation_id || 'txn'}-${payment.created_at || payment.paid_at || ''}`,
    confirmation_code: payment.confirmation_code || reservation.confirmation_code || metadata.confirmation_code || '',
    license_plate: payment.license_plate || reservation.license_plate || metadata.license_plate || '',
    full_name: payment.full_name || reservation.full_name || metadata.full_name || '',
    phone: payment.phone || reservation.phone || metadata.phone || '',
    slot_id: payment.slot_id || reservation.slot_id || metadata.slot_id || '',
    zone: payment.zone || reservation.zone || metadata.zone || '',
    amount: Number(payment.amount || 0),
    currency: payment.currency || reservation.currency || 'USD',
    status: payment.status === 'completed' ? 'paid' : (payment.status || reservation.payment_status || 'pending'),
    payment_method: payment.payment_method || metadata.payment_method || reservation.payment_method || 'cash',
    created_at: payment.created_at || payment.paid_at || null,
    paid_at: payment.paid_at || payment.created_at || null,
    notes: payment.notes || metadata.notes || '',
    amount_received: payment.amount_received ?? metadata.amount_received ?? null,
    change_due: payment.change_due ?? metadata.change_due ?? null,
    reservation: reservation || null,
  };
};

const buildReceiptMarkup = (transaction) => `
  <html>
    <head>
      <title>Receipt ${transaction?.confirmation_code || ''}</title>
      <style>
        body { font-family: Inter, Arial, sans-serif; padding: 24px; color: #0f172a; }
        h1 { font-size: 22px; margin-bottom: 18px; }
        .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
        .label { color: #64748b; }
        .value { font-weight: 700; }
      </style>
    </head>
    <body>
      <h1>SmartParking Receipt</h1>
      <div class="row"><span class="label">Confirmation Code</span><span class="value">${transaction?.confirmation_code || '—'}</span></div>
      <div class="row"><span class="label">Customer</span><span class="value">${transaction?.full_name || 'Guest'}</span></div>
      <div class="row"><span class="label">License Plate</span><span class="value">${transaction?.license_plate || '—'}</span></div>
      <div class="row"><span class="label">Slot / Zone</span><span class="value">${transaction?.slot_id || 'Auto'} / ${transaction?.zone || 'A'}</span></div>
      <div class="row"><span class="label">Payment Method</span><span class="value">${transaction?.payment_method || 'cash'}</span></div>
      <div class="row"><span class="label">Amount</span><span class="value">${formatMoney(transaction?.amount, transaction?.currency)}</span></div>
      <div class="row"><span class="label">Processed At</span><span class="value">${formatDateTime(transaction?.paid_at || transaction?.created_at)}</span></div>
    </body>
  </html>
`;

const shiftInfo = () => {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 14) return { label: 'Shift 1', name: 'Morning' };
  if (hour >= 14 && hour < 22) return { label: 'Shift 2', name: 'Afternoon' };
  return { label: 'Shift 3', name: 'Night' };
};

const defaultNotifications = [
  {
    id: 'desk-ready',
    title: 'Cashier workstation ready',
    description: 'Scanner, lookup, and payment desk are available.',
    timestamp: new Date().toISOString(),
    severity: 'info',
    type: 'desk',
  },
];

const ModalShell = ({ title, icon: Icon, subtitle, onClose, children, wide = false, className = '' }) => (
  <div className="cashier-modal-overlay" onClick={onClose}>
    <div className={`cashier-modal glass ${wide ? 'wide' : ''} ${className}`.trim()} onClick={(event) => event.stopPropagation()}>
      <div className="cashier-modal-head">
        <div>
          <h3 className="cashier-modal-title">
            {Icon ? <Icon size={18} /> : null}
            <span>{title}</span>
          </h3>
          {subtitle ? <p className="cashier-modal-subtitle">{subtitle}</p> : null}
        </div>
        <button type="button" className="cashier-icon-plain" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="cashier-modal-content">{children}</div>
    </div>
  </div>
);

const CashierDashboard = ({ currentUser, token, onLogout }) => {
  const username = currentUser?.username || 'cashier';
  const sessionKey = storageKey('session', username);
  const preferencesKey = storageKey('preferences', username);
  const recentSearchKey = storageKey('recent-searches', username);
  const favoritesKey = storageKey('favorite-plates', username);
  const unreadKey = storageKey('unread-notifications', username);

  const [theme, setTheme] = useState(() => readStored(preferencesKey, DEFAULT_PREFERENCES).theme || 'dark');
  const [preferences, setPreferences] = useState(() => ({ ...DEFAULT_PREFERENCES, ...readStored(preferencesKey, DEFAULT_PREFERENCES) }));
  const [recentSearches, setRecentSearches] = useState(() => readStored(recentSearchKey, []));
  const [favoritePlates, setFavoritePlates] = useState(() => readStored(favoritesKey, []));
  const [notifications, setNotifications] = useState(defaultNotifications);
  const [unreadNotifications, setUnreadNotifications] = useState(() => readStored(unreadKey, defaultNotifications.map((item) => item.id)));

  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [sessionActive, setSessionActive] = useState(true);
  const [breakEndsAt, setBreakEndsAt] = useState(null);
  const [breakStartedAt, setBreakStartedAt] = useState(null);
  const [pausedBreakSeconds, setPausedBreakSeconds] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);

  const [searchCode, setSearchCode] = useState('');
  const [searchPlate, setSearchPlate] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupAmount, setLookupAmount] = useState(0);
  const [lookupCurrency, setLookupCurrency] = useState('USD');
  const [receiptTransaction, setReceiptTransaction] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const [message, setMessage] = useState({ type: '', text: '' });
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  const [openMenu, setOpenMenu] = useState('');
  const [activeModal, setActiveModal] = useState('');
  const [activeFaq, setActiveFaq] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Ready to scan');
  const [scannerError, setScannerError] = useState('');
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');

  const [paymentForm, setPaymentForm] = useState({
    method: 'cash',
    amountReceived: '',
    notes: '',
    printReceipt: true,
  });

  const [bugForm, setBugForm] = useState({
    title: '',
    description: '',
    severity: 'medium',
    steps: '',
    email: '',
    screenshots: [],
  });

  const [supportForm, setSupportForm] = useState({
    subject: '',
    message: '',
    email: currentUser?.username || '',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [requestForm, setRequestForm] = useState({
    type: 'extend',
    title: '',
    description: '',
    priority: 'medium',
  });

  const [filters, setFilters] = useState({
    query: '',
    status: 'all',
    method: 'all',
    range: 'today',
    sort: 'recent',
    pageSize: 10,
    page: 1,
  });

  const qrInputRef = useRef(null);
  const plateInputRef = useRef(null);
  const menuRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanIntervalRef = useRef(null);
  const detectorRef = useRef(null);
  const scanBusyRef = useRef(false);
  const scannerSessionRef = useRef(0);

  const scannerSupported = typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia);

  const shift = useMemo(() => shiftInfo(), []);

  useEffect(() => {
    const stored = readStored(sessionKey, null);
    if (stored?.startedAt) {
      setSessionStartedAt(stored.startedAt);
      setSessionActive(stored.active !== false);
      setBreakEndsAt(stored.breakEndsAt || null);
      if (stored.breakStartedAt) {
        setBreakStartedAt(stored.breakStartedAt);
      } else if (stored.breakEndsAt) {
        setBreakStartedAt(new Date(new Date(stored.breakEndsAt).getTime() - (BREAK_DURATION_SECONDS * 1000)).toISOString());
      }
      setPausedBreakSeconds(Number(stored.pausedBreakSeconds || 0));
      return;
    }

    const startedAt = new Date().toISOString();
    setSessionStartedAt(startedAt);
    setSessionActive(true);
    setBreakStartedAt(null);
    setPausedBreakSeconds(0);
    writeStored(sessionKey, { startedAt, active: true, breakEndsAt: null, breakStartedAt: null, pausedBreakSeconds: 0 });
  }, [sessionKey]);

  useEffect(() => {
    if (!sessionStartedAt) return;
    writeStored(sessionKey, {
      startedAt: sessionStartedAt,
      active: sessionActive,
      breakEndsAt,
      breakStartedAt,
      pausedBreakSeconds,
    });
  }, [breakEndsAt, breakStartedAt, pausedBreakSeconds, sessionActive, sessionKey, sessionStartedAt]);

  useEffect(() => {
    const updateClock = () => {
      if (!sessionStartedAt || !sessionActive) {
        setSessionTime(0);
        return;
      }
      const started = new Date(sessionStartedAt).getTime();
      if (Number.isNaN(started)) {
        setSessionTime(0);
        return;
      }
      const activeBreakSeconds = breakStartedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(breakStartedAt).getTime()) / 1000))
        : 0;
      setSessionTime(Math.max(0, Math.floor((Date.now() - started) / 1000) - pausedBreakSeconds - activeBreakSeconds));
    };

    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, [breakStartedAt, pausedBreakSeconds, sessionActive, sessionStartedAt]);

  useEffect(() => {
    writeStored(preferencesKey, preferences);
    setTheme(preferences.theme);
  }, [preferences, preferencesKey]);

  useEffect(() => writeStored(recentSearchKey, recentSearches), [recentSearchKey, recentSearches]);
  useEffect(() => writeStored(favoritesKey, favoritePlates), [favoritePlates, favoritesKey]);
  useEffect(() => writeStored(unreadKey, unreadNotifications), [unreadKey, unreadNotifications]);

  useEffect(() => {
    if (!message.text || message.type === 'error') return undefined;
    const timeout = window.setTimeout(() => {
      setMessage((current) => (current.text === message.text ? { type: '', text: '' } : current));
    }, 10000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpenMenu('');
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    const handleNetwork = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      setMessage({
        type: isOnline ? 'success' : 'error',
        text: isOnline ? 'Network connection restored.' : 'You are offline. Live updates may be delayed.',
      });
    };
    window.addEventListener('online', handleNetwork);
    window.addEventListener('offline', handleNetwork);
    return () => {
      window.removeEventListener('online', handleNetwork);
      window.removeEventListener('offline', handleNetwork);
    };
  }, []);

  const breakRemainingSeconds = (() => {
    if (!breakEndsAt) return 0;
    return Math.max(0, Math.floor((new Date(breakEndsAt).getTime() - Date.now()) / 1000));
  })();

  const finalizeBreak = useCallback(() => {
    if (!breakStartedAt) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(breakStartedAt).getTime()) / 1000));
    setPausedBreakSeconds((previous) => previous + elapsed);
    setBreakStartedAt(null);
  }, [breakStartedAt]);

  useEffect(() => {
    if (breakEndsAt && breakRemainingSeconds === 0) {
      finalizeBreak();
      setBreakEndsAt(null);
      setMessage({ type: 'success', text: 'Break finished. Cashier session is active again.' });
    }
  }, [breakEndsAt, breakRemainingSeconds, finalizeBreak]);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/alerts?resolved=false&limit=8'));
      const payload = await response.json();
      if (!response.ok) return;
      const next = [...buildAlertNotifications(payload.alerts || []), ...defaultNotifications];
      setNotifications((previous) => {
        const previousIds = new Set(previous.map((item) => item.id));
        setUnreadNotifications((current) => {
          const nextUnread = new Set(
            current.filter((id) => next.some((item) => item.id === id))
          );
          next.forEach((item) => {
            if (!previousIds.has(item.id)) {
              nextUnread.add(item.id);
            }
          });
          return Array.from(nextUnread);
        });
        return next;
      });
    } catch {}
  }, []);

  const handleNotificationClick = useCallback((item) => {
    setUnreadNotifications((previous) => previous.filter((entry) => entry !== item.id));
    if (!preferences.notificationsEnabled) return;
    if (item.description) {
      setMessage({ type: item.severity === 'high' ? 'error' : 'success', text: item.description });
    }
  }, [preferences.notificationsEnabled]);

  const handleMarkAllNotificationsRead = useCallback(() => {
    setUnreadNotifications([]);
  }, []);

  const loadTransactions = useCallback(async () => {
    setLoadingTransactions(true);
    try {
      let response = await authFetch('/cashier/payments', {}, token);
      let payload = await response.json();
      if (response.ok) {
        setTransactions((payload.payments || []).map(normalizeTransaction));
        return;
      }

      response = await authFetch('/cash-payments', {}, token);
      payload = await response.json();
      if (response.ok) {
        setTransactions((payload.cash_payments || []).map(normalizeTransaction));
      } else {
        setTransactions([]);
      }
    } catch {
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  }, [token]);

  useEffect(() => {
    loadTransactions();
    loadNotifications();
  }, [loadNotifications, loadTransactions]);

  useEffect(() => {
    const timer = window.setInterval(loadNotifications, 20000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const todayTransactions = useMemo(() => {
    const today = new Date().toDateString();
    return transactions.filter((item) => new Date(item.paid_at || item.created_at || Date.now()).toDateString() === today);
  }, [transactions]);

  const todayTotal = useMemo(
    () => todayTransactions.filter((item) => String(item.status || '').toLowerCase() === 'paid').reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [todayTransactions]
  );

  const unreadCount = notifications.filter((item) => unreadNotifications.includes(item.id)).length;

  const scannerStatusText = scannerError
    ? 'Not Connected'
    : scannerSupported
      ? 'Camera Ready'
      : 'Scanner Unavailable';

  const addRecentSearch = useCallback((entry) => {
    setRecentSearches((previous) => [entry, ...previous.filter((item) => item.id !== entry.id)].slice(0, 5));
  }, []);

  const syncPaymentForm = useCallback((reservation, amountDue) => {
    setPaymentForm({
      method: reservation?.payment_method || 'cash',
      amountReceived: Number(amountDue || 0) > 0 ? Number(amountDue || 0).toFixed(2) : '',
      notes: '',
      printReceipt: true,
    });
  }, []);

  const lookupReservation = useCallback(async ({ code = '', plate = '', source = 'manual' } = {}) => {
    const lookupQuery = buildLookupQuery(code);
    const normalizedPlate = normalizePlate(plate);
    const parsedCode = extractConfirmationCode(code);
    if (!lookupQuery && !normalizedPlate) return;

    setLoadingSearch(true);
    setMessage({ type: '', text: '' });

    try {
      const params = new URLSearchParams();
      if (lookupQuery) params.set('query', lookupQuery);
      if (normalizedPlate) params.set('license_plate', normalizedPlate);

      let response = await authFetch(`/cashier/reservations/lookup?${params.toString()}`, {}, token);
      let payload = await response.json();

      if (!response.ok) {
        const fallbackParams = new URLSearchParams();
        if (parsedCode) fallbackParams.set('confirmation_code', parsedCode);
        if (normalizedPlate) fallbackParams.set('license_plate', normalizedPlate);

        response = await fetch(apiUrl(`/public/reservations/lookup?${fallbackParams.toString()}`));
        payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Reservation not found');
      }

      const reservation = payload.reservation || null;
      const amountDue = Number(payload.amount_due || reservation?.estimated_amount || 0);
      const currency = payload.currency || reservation?.currency || 'USD';

      setLookupResult(reservation);
      setLookupAmount(amountDue);
      setLookupCurrency(currency);
      setSearchCode(reservation?.confirmation_code || parsedCode || code || '');
      setSearchPlate(reservation?.license_plate || normalizedPlate);
      syncPaymentForm(reservation, amountDue);

      const transaction = payload.payment ? normalizeTransaction({ ...payload.payment, reservation }) : null;
      setReceiptTransaction(transaction);
      addRecentSearch({
        id: reservation?.id || `${parsedCode}-${normalizedPlate}`,
        code: reservation?.confirmation_code || parsedCode || '',
        plate: reservation?.license_plate || normalizedPlate || '',
        time: new Date().toISOString(),
      });

      setMessage({
        type: 'success',
        text: source === 'scanner'
          ? `Reservation ${reservation?.confirmation_code || parsedCode} loaded from scanner.`
          : `Reservation ${reservation?.confirmation_code || parsedCode || normalizedPlate} loaded successfully.`,
      });
    } catch (error) {
      setLookupResult(null);
      setLookupAmount(0);
      setLookupCurrency('USD');
      setReceiptTransaction(null);
      setMessage({ type: 'error', text: error.message || 'Reservation not found' });
    } finally {
      setLoadingSearch(false);
    }
  }, [addRecentSearch, syncPaymentForm, token]);

  const clearSearch = () => {
    setSearchCode('');
    setSearchPlate('');
    setLookupResult(null);
    setLookupAmount(0);
    setLookupCurrency('USD');
    setReceiptTransaction(null);
    setPaymentForm({ method: 'cash', amountReceived: '', notes: '', printReceipt: true });
    setMessage({ type: '', text: '' });
  };

  const openPaymentModal = useCallback(() => {
    if (!lookupResult?.id) {
      setMessage({ type: 'error', text: 'Search for a reservation before opening the payment desk.' });
      return;
    }
    syncPaymentForm(lookupResult, lookupAmount);
    setActiveModal('payment');
  }, [lookupAmount, lookupResult, syncPaymentForm]);

  const openReceiptModal = useCallback((transaction = null) => {
    const linked = transaction
      || receiptTransaction
      || transactions.find((item) => (
        (lookupResult?.id && item.reservation_id === lookupResult.id)
        || (lookupResult?.confirmation_code && item.confirmation_code === lookupResult.confirmation_code)
      ))
      || null;
    if (!linked) {
      setMessage({ type: 'error', text: 'No receipt data is available for this reservation yet.' });
      return;
    }
    setReceiptTransaction(normalizeTransaction(linked));
    setActiveModal('receipt');
  }, [lookupResult, receiptTransaction, transactions]);

  const handleUpdatePaymentStatus = async ({ paymentStatus, method, amountReceived, notes }) => {
    if (!lookupResult?.id) return;
    const normalizedMethod = PAYMENT_METHODS.some((item) => item.value === method) ? method : 'cash';
    const amountDueValue = Number(lookupAmount || 0);
    const rawAmountReceived = amountReceived == null ? '' : String(amountReceived).trim();
    const amountReceivedValue = rawAmountReceived === ''
      ? (paymentStatus === 'paid' ? amountDueValue : null)
      : Number(rawAmountReceived);

    if (paymentStatus === 'paid' && Number.isNaN(amountReceivedValue)) {
      setMessage({ type: 'error', text: 'Enter a valid received amount before confirming payment.' });
      return;
    }

    if (paymentStatus === 'paid' && normalizedMethod === 'cash' && amountReceivedValue !== null && amountReceivedValue < amountDueValue) {
      setMessage({ type: 'error', text: 'Amount received must cover the amount due before marking cash as paid.' });
      return;
    }

    setLoadingPayment(true);
    try {
      let response = await authFetch(`/cashier/reservations/${lookupResult.id}/payment-status`, {
        method: 'PUT',
        body: JSON.stringify({
          payment_status: paymentStatus,
          payment_method: normalizedMethod,
          notes,
          amount_received: amountReceivedValue,
        }),
      }, token);
      let payload = await response.json().catch(() => ({}));

      if (!response.ok && response.status === 404 && paymentStatus === 'paid' && normalizedMethod === 'cash') {
        response = await authFetch('/cash-payments', {
          method: 'POST',
          body: JSON.stringify({
            reservation_id: lookupResult.id,
            amount: amountDueValue,
            notes,
          }),
        }, token);
        const fallbackPayload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(fallbackPayload.detail || payload.detail || 'Failed to update payment');
        payload = {
          reservation: fallbackPayload.reservation || lookupResult,
          cash_payment: fallbackPayload.cash_payment || null,
          amount_due: fallbackPayload.cash_payment?.amount ?? amountDueValue,
          currency: fallbackPayload.cash_payment?.currency || lookupCurrency || 'USD',
          payment_method: 'cash',
          change_due: amountReceivedValue != null ? Math.max(0, amountReceivedValue - amountDueValue) : null,
        };
      } else if (!response.ok) {
        throw new Error(payload.detail || 'Failed to update payment');
      }

      const reservation = payload.reservation || null;
      const amountDue = Number(payload.amount_due || reservation?.estimated_amount || 0);
      const currency = payload.currency || reservation?.currency || 'USD';
      const shouldOpenReceipt = paymentForm.printReceipt;

      setLookupResult(reservation);
      setLookupAmount(amountDue);
      setLookupCurrency(currency);
      syncPaymentForm(reservation, amountDue);

      const transaction = normalizeTransaction({
        ...(payload.cash_payment || payload.payment || {}),
        reservation,
        amount: payload.amount_due || amountDue,
        currency,
        payment_method: payload.payment_method || normalizedMethod,
        amount_received: amountReceivedValue,
        change_due: payload.change_due,
        notes,
      });
      setReceiptTransaction(transaction);
      setTransactions((previous) => {
        const next = [transaction, ...previous.filter((item) => {
          if (item.id === transaction.id) return false;
          if (transaction.reservation_id && item.reservation_id === transaction.reservation_id) return false;
          if (transaction.confirmation_code && item.confirmation_code === transaction.confirmation_code) return false;
          return true;
        })];
        return next.slice(0, 300);
      });

      setMessage({
        type: 'success',
        text: paymentStatus === 'paid'
          ? `${normalizedMethod} payment recorded for ${reservation?.confirmation_code || lookupResult.confirmation_code}.`
          : `Payment reset to pending for ${reservation?.confirmation_code || lookupResult.confirmation_code}.`,
      });

      await loadTransactions();

      if (paymentStatus === 'paid') {
        setActiveModal(shouldOpenReceipt ? 'receipt' : '');
      } else {
        setActiveModal('');
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to update payment' });
    } finally {
      setLoadingPayment(false);
    }
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    await handleUpdatePaymentStatus({
      paymentStatus: 'paid',
      method: paymentForm.method,
      amountReceived: paymentForm.amountReceived,
      notes: paymentForm.notes,
    });
  };

  const markPending = async () => {
    await handleUpdatePaymentStatus({
      paymentStatus: 'pending',
      method: paymentForm.method,
      amountReceived: '',
      notes: paymentForm.notes,
    });
  };

  const submitIssue = useCallback(async ({ title, description, priority }) => {
    const response = await authFetch('/issues', {
      method: 'POST',
      body: JSON.stringify({ title, description, priority }),
    }, token);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Failed to submit request');
    return payload.issue;
  }, [token]);

  const handleBugSubmit = async (event) => {
    event.preventDefault();
    if (!bugForm.title.trim() || !bugForm.description.trim()) {
      setMessage({ type: 'error', text: 'Bug title and description are required.' });
      return;
    }
    try {
      const issue = await submitIssue({
        title: `[Cashier Bug] ${bugForm.title.trim()}`,
        description: [
          bugForm.description.trim(),
          bugForm.steps ? `Steps:\n${bugForm.steps.trim()}` : null,
          bugForm.email ? `Email: ${bugForm.email.trim()}` : null,
          `Device: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
          bugForm.screenshots.length ? `Attachments: ${bugForm.screenshots.map((file) => file.name).join(', ')}` : null,
        ].filter(Boolean).join('\n\n'),
        priority: bugForm.severity,
      });
      setMessage({ type: 'success', text: `Bug report sent to admin queue as issue #${issue.id}.` });
      setBugForm({ title: '', description: '', severity: 'medium', steps: '', email: '', screenshots: [] });
      setActiveModal('');
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to submit bug report' });
    }
  };

  const handleSupportSubmit = async (event) => {
    event.preventDefault();
    if (!supportForm.subject.trim() || !supportForm.message.trim()) {
      setMessage({ type: 'error', text: 'Support subject and message are required.' });
      return;
    }
    try {
      const issue = await submitIssue({
        title: `[Support] ${supportForm.subject.trim()}`,
        description: `${supportForm.message.trim()}\n\nContact: ${supportForm.email || username}`,
        priority: 'medium',
      });
      setMessage({ type: 'success', text: `Support request submitted as issue #${issue.id}.` });
      setActiveModal('');
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to send support request' });
    }
  };

  const handleChangePasswordSubmit = async (event) => {
    event.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setMessage({ type: 'error', text: 'Complete all password fields.' });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage({ type: 'error', text: 'New password confirmation does not match.' });
      return;
    }
    try {
      const response = await authFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to update password');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage({ type: 'success', text: payload.message || 'Password updated.' });
      setActiveModal('');
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to update password' });
    }
  };

  const openOperationalRequest = useCallback((type, transaction = null) => {
    if (type === 'extend') {
      if (!lookupResult?.id) {
        setMessage({ type: 'error', text: 'Search for a reservation before requesting an extension.' });
        return;
      }
      setRequestForm({
        type,
        title: `Extend reservation ${lookupResult.confirmation_code}`,
        description: [
          `Reservation: ${lookupResult.confirmation_code}`,
          `Plate: ${lookupResult.license_plate || 'N/A'}`,
          `Slot / Zone: ${lookupResult.slot_id || 'Auto'} / ${lookupResult.zone || 'A'}`,
          '',
          'Requested change:',
        ].join('\n'),
        priority: 'medium',
      });
      setActiveModal('request');
      return;
    }

    const target = transaction || receiptTransaction || transactions.find((item) => String(item.status || '').toLowerCase() === 'paid') || null;
    if (!target) {
      setMessage({ type: 'error', text: 'No paid transaction is available for a refund request.' });
      return;
    }
    setRequestForm({
      type,
      title: `Refund request ${target.confirmation_code || `Reservation #${target.reservation_id}`}`,
      description: [
        `Reservation: ${target.confirmation_code || target.reservation_id}`,
        `Plate: ${target.license_plate || 'N/A'}`,
        `Amount: ${formatMoney(target.amount, target.currency)}`,
        '',
        'Refund reason:',
      ].join('\n'),
      priority: 'high',
    });
    setActiveModal('request');
  }, [lookupResult, receiptTransaction, transactions]);

  const handleOperationalRequestSubmit = async (event) => {
    event.preventDefault();
    if (!requestForm.title.trim() || !requestForm.description.trim()) {
      setMessage({ type: 'error', text: 'Request title and details are required.' });
      return;
    }
    try {
      const issue = await submitIssue({
        title: `[Cashier ${requestForm.type === 'refund' ? 'Refund' : 'Extension'}] ${requestForm.title.trim()}`,
        description: requestForm.description.trim(),
        priority: requestForm.priority,
      });
      setMessage({
        type: 'success',
        text: `${requestForm.type === 'refund' ? 'Refund' : 'Extension'} request submitted as issue #${issue.id}.`,
      });
      setActiveModal('');
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to submit request' });
    }
  };

  const printReceipt = (transaction) => {
    const popup = window.open('', '_blank', 'width=760,height=840');
    if (!popup) return;
    popup.document.write(buildReceiptMarkup(transaction));
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const exportTransactions = () => {
    const rows = filteredTransactions;
    if (!rows.length) {
      setMessage({ type: 'error', text: 'There are no transactions to export.' });
      return;
    }
    const headers = ['Time', 'Confirmation Code', 'Plate', 'Customer', 'Amount', 'Method', 'Status'];
    const body = rows.map((item) => [
      formatDateTime(item.paid_at || item.created_at, ''),
      item.confirmation_code || '',
      item.license_plate || '',
      item.full_name || '',
      Number(item.amount || 0).toFixed(2),
      item.payment_method || '',
      item.status || '',
    ]);
    const csv = [headers, ...body]
      .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cashier-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const toggleFavoritePlate = () => {
    const plate = lookupResult?.license_plate;
    if (!plate) return;
    setFavoritePlates((previous) => (
      previous.includes(plate)
        ? previous.filter((item) => item !== plate)
        : [plate, ...previous.filter((item) => item !== plate)].slice(0, 8)
    ));
  };

  const loadSearchEntry = (entry) => {
    setSearchCode(entry.code || '');
    setSearchPlate(entry.plate || '');
    lookupReservation({ code: entry.code || '', plate: entry.plate || '' });
  };

  const handleStartSession = () => {
    const startedAt = new Date().toISOString();
    setSessionStartedAt(startedAt);
    setSessionActive(true);
    setBreakEndsAt(null);
    setBreakStartedAt(null);
    setPausedBreakSeconds(0);
    setMessage({ type: 'success', text: 'New cashier session started.' });
  };

  const handleEndSession = () => {
    if (!window.confirm('End the current cashier session?')) return;
    finalizeBreak();
    setSessionActive(false);
    setBreakEndsAt(null);
    setBreakStartedAt(null);
    setActiveModal('shift-summary');
    setMessage({ type: 'success', text: 'Cashier session ended.' });
  };

  const toggleBreak = () => {
    if (!sessionActive) {
      setMessage({ type: 'error', text: 'Start a session before taking a break.' });
      return;
    }
    if (breakEndsAt) {
      finalizeBreak();
      setBreakEndsAt(null);
      setMessage({ type: 'success', text: 'Break ended. Session is active.' });
      return;
    }
    setBreakStartedAt(new Date().toISOString());
    setBreakEndsAt(new Date(Date.now() + BREAK_DURATION_SECONDS * 1000).toISOString());
    setMessage({ type: 'success', text: '15 minute break started.' });
  };

  const performQuickAction = (id) => {
    if (id === 'new-payment') {
      openPaymentModal();
      return;
    }
    if (id === 'extend') {
      openOperationalRequest('extend');
      return;
    }
    if (id === 'refund') {
      openOperationalRequest('refund');
      return;
    }
    if (id === 'receipt') {
      openReceiptModal();
      return;
    }
    if (id === 'break') {
      toggleBreak();
      return;
    }
    if (id === 'end-session') {
      handleEndSession();
    }
  };

  const detectQrValue = useCallback(async (video) => {
    if (!video || video.readyState < 2) return '';

    if ('BarcodeDetector' in window) {
      if (!detectorRef.current) {
        detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
      }
      const detections = await detectorRef.current.detect(video);
      const detected = detections.find((item) => typeof item.rawValue === 'string' && item.rawValue.trim())?.rawValue?.trim();
      if (detected) return detected;
    }

    const canvas = canvasRef.current;
    if (!canvas) return '';
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) return '';
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return '';
    context.drawImage(video, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const result = jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });
    return result?.data?.trim() || '';
  }, []);

  const cleanupScannerMedia = useCallback(() => {
    if (scanIntervalRef.current) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    scanBusyRef.current = false;
  }, []);

  const stopScanner = useCallback(() => {
    scannerSessionRef.current += 1;
    cleanupScannerMedia();
  }, [cleanupScannerMedia]);

  const startScanner = useCallback(async () => {
    if (!scannerSupported) {
      setScannerError('Camera scanning is not supported in this browser.');
      setScannerStatus('Scanner unavailable');
      return;
    }

    const sessionId = scannerSessionRef.current + 1;
    scannerSessionRef.current = sessionId;
    cleanupScannerMedia();
    setScannerError('');
    setScannerStatus('Starting camera...');

    try {
      const constraints = selectedCameraId
        ? { video: { deviceId: { exact: selectedCameraId } }, audio: false }
        : { video: { facingMode: { ideal: 'environment' } }, audio: false };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (sessionId !== scannerSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameraDevices(devices.filter((device) => device.kind === 'videoinput'));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setScannerStatus('Scanning reservation QR...');
      scanIntervalRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || scanBusyRef.current) return;
        scanBusyRef.current = true;
        try {
          const qrValue = await detectQrValue(video);
          if (qrValue) {
            setScannerStatus('QR detected. Loading reservation...');
            setScannerOpen(false);
            await lookupReservation({ code: qrValue, source: 'scanner' });
          }
        } catch {
        } finally {
          scanBusyRef.current = false;
        }
      }, 350);
    } catch (error) {
      cleanupScannerMedia();
      setScannerError(
        error?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow access and reopen the scanner.'
          : error?.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : 'Unable to start the QR scanner.'
      );
      setScannerStatus('Scanner unavailable');
    }
  }, [cleanupScannerMedia, detectQrValue, lookupReservation, scannerSupported, selectedCameraId]);

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner();
      return undefined;
    }
    startScanner();
    return () => stopScanner();
  }, [scannerOpen, selectedCameraId, startScanner, stopScanner]);

  const openScanner = () => {
    setScannerStatus('Preparing scanner...');
    setScannerError('');
    setScannerOpen(true);
  };

  const closeScanner = () => {
    setScannerOpen(false);
    setScannerStatus('Ready to scan');
    setScannerError('');
  };

  useEffect(() => {
    const handler = (event) => {
      const key = event.key.toLowerCase();
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '');

      if (event.key === 'Escape') {
        setOpenMenu('');
        if (scannerOpen) closeScanner();
        else if (activeModal) setActiveModal('');
        return;
      }

      if (!event.ctrlKey) return;

      if (key === 'q') {
        event.preventDefault();
        qrInputRef.current?.focus();
      } else if (key === 'p') {
        event.preventDefault();
        plateInputRef.current?.focus();
      } else if (key === 's') {
        event.preventDefault();
        lookupReservation({ code: searchCode, plate: searchPlate });
      } else if (key === 'r') {
        event.preventDefault();
        openScanner();
      } else if (key === 'n') {
        event.preventDefault();
        openPaymentModal();
      } else if ((event.key === '?' || key === '/') && !isTyping) {
        event.preventDefault();
        setActiveModal('shortcuts');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeModal, lookupReservation, openPaymentModal, scannerOpen, searchCode, searchPlate]);

  const filteredTransactions = useMemo(() => {
    let items = [...transactions];
    const now = Date.now();

    if (filters.range === 'today') {
      const today = new Date().toDateString();
      items = items.filter((item) => new Date(item.paid_at || item.created_at || now).toDateString() === today);
    } else if (filters.range === '2h') {
      items = items.filter((item) => now - new Date(item.paid_at || item.created_at || now).getTime() <= 2 * 60 * 60 * 1000);
    }

    if (filters.status !== 'all') {
      items = items.filter((item) => String(item.status || '').toLowerCase() === filters.status);
    }
    if (filters.method !== 'all') {
      items = items.filter((item) => String(item.payment_method || '').toLowerCase() === filters.method);
    }
    if (filters.query.trim()) {
      const query = filters.query.trim().toLowerCase();
      items = items.filter((item) => (
        String(item.confirmation_code || '').toLowerCase().includes(query)
        || String(item.license_plate || '').toLowerCase().includes(query)
        || String(item.full_name || '').toLowerCase().includes(query)
      ));
    }

    if (filters.sort === 'amount') {
      items.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    } else if (filters.sort === 'oldest') {
      items.sort((a, b) => new Date(a.paid_at || a.created_at || 0).getTime() - new Date(b.paid_at || b.created_at || 0).getTime());
    } else {
      items.sort((a, b) => new Date(b.paid_at || b.created_at || 0).getTime() - new Date(a.paid_at || a.created_at || 0).getTime());
    }

    return items;
  }, [filters, transactions]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / Number(filters.pageSize || 10)));
  const paginatedTransactions = useMemo(() => {
    const start = (filters.page - 1) * filters.pageSize;
    return filteredTransactions.slice(start, start + Number(filters.pageSize));
  }, [filteredTransactions, filters.page, filters.pageSize]);

  useEffect(() => {
    setFilters((previous) => ({ ...previous, page: Math.min(previous.page, totalPages) }));
  }, [totalPages]);

  const fontScaleClass = preferences.fontScale === 'large'
    ? 'font-large'
    : preferences.fontScale === 'compact'
      ? 'font-compact'
      : '';

  const lastTransaction = transactions[0] || null;

  return (
    <div className={`cashier-page ${theme === 'light' ? 'theme-light' : ''} ${fontScaleClass}`}>
      <header className="cashier-header glass">
        <div className="cashier-header-left">
          <div className="cashier-brand">
            <div className="cashier-brand-mark">P</div>
            <div className="cashier-brand-block">
              <div className="cashier-brand-name">SmartParking</div>
              <div className="cashier-brand-subline">
                <span className="cashier-badge">Cashier Portal</span>
                <span className="cashier-online-pill">
                  <span className="cashier-online-dot" />
                  Online
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="cashier-header-right" ref={menuRef}>
          <button type="button" className="cashier-icon-btn" onClick={() => setPreferences((previous) => ({ ...previous, theme: previous.theme === 'dark' ? 'light' : 'dark' }))}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="cashier-menu-anchor">
            <button type="button" className="cashier-menu-btn" onClick={() => setOpenMenu(openMenu === 'help' ? '' : 'help')}>
              <HelpCircle size={18} />
              <span>Help</span>
              <ChevronDown size={16} />
            </button>
            {openMenu === 'help' && (
              <div className="cashier-dropdown-menu">
                {SUPPORT_LINKS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="cashier-dropdown-item"
                      onClick={() => {
                        setOpenMenu('');
                        setActiveModal(item.id);
                      }}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button type="button" className="cashier-danger-btn" onClick={() => setActiveModal('bug')}>
            <Bug size={18} />
            <span>Report Bug</span>
          </button>

          <div className="cashier-menu-anchor">
            <button type="button" className="cashier-icon-btn has-badge" onClick={() => setOpenMenu(openMenu === 'notifications' ? '' : 'notifications')}>
              <Bell size={18} />
              {unreadCount > 0 ? <span className="cashier-badge-counter">{unreadCount}</span> : null}
            </button>
            {openMenu === 'notifications' && (
              <div className="cashier-dropdown-menu wide">
                <div className="cashier-dropdown-head">
                  <strong>Notifications</strong>
                  <button type="button" className="cashier-inline-link" onClick={handleMarkAllNotificationsRead}>
                    Mark all read
                  </button>
                </div>
                <div className="cashier-dropdown-scroll">
                  {notifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`cashier-notification-item ${unreadNotifications.includes(item.id) ? 'unread' : ''}`}
                      onClick={() => handleNotificationClick(item)}
                    >
                      <div className="cashier-notification-title">{item.title}</div>
                      <div className="cashier-notification-desc">{item.description}</div>
                      <div className="cashier-notification-time">{formatDateTime(item.timestamp)}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="cashier-menu-anchor">
            <button type="button" className="cashier-profile-btn" onClick={() => setOpenMenu(openMenu === 'profile' ? '' : 'profile')}>
              <span className="cashier-avatar">{(currentUser?.username || 'C').slice(0, 1).toUpperCase()}</span>
              <span className="cashier-profile-meta">
                <strong>{currentUser?.username || 'cashier'}</strong>
                <small>{currentUser?.role || 'cashier'}</small>
              </span>
              <ChevronDown size={16} />
            </button>
            {openMenu === 'profile' && (
              <div className="cashier-dropdown-menu">
                <button type="button" className="cashier-dropdown-item" onClick={() => { setOpenMenu(''); setActiveModal('profile'); }}>
                  <User size={16} />
                  <span>My Profile</span>
                </button>
                <button type="button" className="cashier-dropdown-item" onClick={() => { setOpenMenu(''); setActiveModal('change-password'); }}>
                  <ShieldCheck size={16} />
                  <span>Change Password</span>
                </button>
                <button type="button" className="cashier-dropdown-item" onClick={() => { setOpenMenu(''); setActiveModal('preferences'); }}>
                  <Settings2 size={16} />
                  <span>Preferences</span>
                </button>
                <button type="button" className="cashier-dropdown-item" onClick={() => { setOpenMenu(''); setActiveModal('activity'); }}>
                  <History size={16} />
                  <span>Activity Log</span>
                </button>
                <button type="button" className="cashier-dropdown-item danger" onClick={onLogout}>
                  <LogOut size={16} />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="cashier-content">
        {message.text ? (
          <div className={`cashier-banner ${message.type === 'error' ? 'error' : 'success'}`}>
            <span>{message.text}</span>
            <button type="button" className="cashier-icon-plain" onClick={() => setMessage({ type: '', text: '' })}>
              <X size={16} />
            </button>
          </div>
        ) : null}

        <div className="cashier-hero-grid">
          <section className="cashier-session-card glass">
            <div className="cashier-panel-head compact">
              <div>
                <div className="cashier-section-kicker">Session Status</div>
                <h2 className="cashier-session-clock">SESSION {sessionActive ? formatClock(sessionTime) : 'STOPPED'}</h2>
              </div>
              <div className={`cashier-status-chip ${breakEndsAt ? 'warning' : (sessionActive ? 'success' : 'danger')}`}>
                {breakEndsAt ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                <span>{breakEndsAt ? 'On Break' : (sessionActive ? 'Active' : 'Stopped')}</span>
              </div>
            </div>
            <div className="cashier-session-grid">
              <div className="cashier-mini-stat">
                <span>Started</span>
                <strong>{formatDateTime(sessionStartedAt, 'Now')}</strong>
              </div>
              <div className="cashier-mini-stat">
                <span>Shift</span>
                <strong>{shift.label} / {shift.name}</strong>
              </div>
              <div className="cashier-mini-stat">
                <span>Break Remaining</span>
                <strong>{breakEndsAt ? formatClock(breakRemainingSeconds) : 'Available'}</strong>
              </div>
              <div className="cashier-mini-stat">
                <span>Desk Health</span>
                <strong>{online ? 'Online' : 'Offline'}</strong>
              </div>
            </div>
            <div className="cashier-session-actions">
              {sessionActive ? (
                <button type="button" className="cashier-btn cashier-btn-danger" onClick={handleEndSession}>
                  <X size={16} />
                  End Session
                </button>
              ) : (
                <button type="button" className="cashier-btn cashier-btn-success" onClick={handleStartSession}>
                  <PlayCircle size={16} />
                  Start Session
                </button>
              )}
              <button type="button" className="cashier-btn cashier-btn-warning" onClick={toggleBreak}>
                {breakEndsAt ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                {breakEndsAt ? 'Resume Session' : 'Take Break'}
              </button>
            </div>
          </section>

          <div className="cashier-stats-grid">
            <article className="cashier-stat-card glass">
              <div className="cashier-stat-label">Today&apos;s Payments</div>
              <div className="cashier-stat-value">{todayTransactions.length}</div>
              <div className="cashier-stat-note">Transactions processed today</div>
            </article>
            <article className="cashier-stat-card glass">
              <div className="cashier-stat-label">Total Collected</div>
              <div className="cashier-stat-value accent">{formatMoney(todayTotal, preferences.currency)}</div>
              <div className="cashier-stat-note">Combined paid amount on this desk</div>
            </article>
            <article className="cashier-stat-card glass">
              <div className="cashier-stat-label">Session Time</div>
              <div className="cashier-stat-value">{sessionActive ? formatClock(sessionTime) : '00:00:00'}</div>
              <div className="cashier-stat-note">Persists until cashier ends session</div>
            </article>
          </div>
        </div>

        <div className="cashier-main-grid">
          <div className="cashier-stack cashier-primary-column">
            <section className="cashier-panel cashier-panel-lookup glass">
              <div className="cashier-panel-head">
                <div>
                  <h2>Reservation Lookup</h2>
                  <p>Paste QR content, reservation code, or search by license plate.</p>
                </div>
                <button type="button" className="cashier-btn cashier-btn-ghost" onClick={clearSearch}>
                  <X size={16} />
                  Clear Fields
                </button>
              </div>

              <form className="cashier-search-grid" onSubmit={(event) => {
                event.preventDefault();
                lookupReservation({ code: searchCode, plate: searchPlate });
              }}>
                <label className="cashier-field">
                  <span>QR / Confirmation Code</span>
                  <input
                    ref={qrInputRef}
                    type="text"
                    value={searchCode}
                    placeholder="Paste scanned QR content or type reservation code"
                    onChange={(event) => setSearchCode(event.target.value)}
                  />
                </label>
                <label className="cashier-field">
                  <span>License Plate</span>
                  <input
                    ref={plateInputRef}
                    type="text"
                    value={searchPlate}
                    placeholder="ABC-1234"
                    onChange={(event) => setSearchPlate(normalizePlate(event.target.value))}
                  />
                </label>
                <div className="cashier-search-actions">
                  <button type="button" className="cashier-btn cashier-btn-info" onClick={openScanner} disabled={!scannerSupported}>
                    <ScanLine size={16} />
                    Open Scanner
                  </button>
                  <button type="submit" className="cashier-btn cashier-btn-primary" disabled={loadingSearch || (!searchCode.trim() && !searchPlate.trim())}>
                    <Search size={16} />
                    {loadingSearch ? 'Searching...' : 'Search Reservation'}
                  </button>
                </div>
              </form>
            </section>

            <div className="cashier-assist-grid">
              <section className="cashier-panel glass">
                <div className="cashier-panel-head">
                  <div>
                    <h2>Recent Searches</h2>
                    <p>Last five reservation lookups on this desk.</p>
                  </div>
                  <button type="button" className="cashier-inline-link" onClick={() => setRecentSearches([])}>Clear</button>
                </div>
                {recentSearches.length === 0 ? (
                  <div className="cashier-empty-state compact">No recent searches yet.</div>
                ) : (
                  <div className="cashier-list">
                    {recentSearches.map((item) => (
                      <button key={item.id} type="button" className="cashier-list-item" onClick={() => loadSearchEntry(item)}>
                        <div>
                          <strong>{item.code || item.plate}</strong>
                          <span>{item.plate || 'Code search'}</span>
                        </div>
                        <small>{formatDateTime(item.time)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="cashier-panel glass">
                <div className="cashier-panel-head">
                  <div>
                    <h2>Favorite Plates</h2>
                    <p>Quick access for repeat visitors.</p>
                  </div>
                </div>
                {favoritePlates.length === 0 ? (
                  <div className="cashier-empty-state compact">Star a reservation plate to keep it here.</div>
                ) : (
                  <div className="cashier-chip-list">
                    {favoritePlates.map((plate) => (
                      <button key={plate} type="button" className="cashier-chip" onClick={() => lookupReservation({ plate })}>
                        {plate}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {lookupResult ? (
              <section className="cashier-panel glass">
                <div className="cashier-panel-head">
                  <div>
                    <h2>Reservation Details</h2>
                    <p>Customer, vehicle, duration, payment state, and cashier actions.</p>
                  </div>
                  <div className="cashier-inline-actions">
                    <button type="button" className={`cashier-icon-btn ${favoritePlates.includes(lookupResult.license_plate) ? 'active' : ''}`} onClick={toggleFavoritePlate}>
                      <Star size={16} />
                    </button>
                    <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => lookupReservation({ code: searchCode, plate: searchPlate })}>
                      <RefreshCw size={16} />
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="cashier-detail-grid">
                  <div className="cashier-detail-card highlight">
                    <span>Confirmation Code</span>
                    <strong>{lookupResult.confirmation_code || 'Not available'}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Reservation Status</span>
                    <strong className={`cashier-pill ${reservationToneClass(lookupResult.status)}`}>{lookupResult.status || 'pending'}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Payment Status</span>
                    <strong className={`cashier-pill ${paymentToneClass(lookupResult.payment_status)}`}>{lookupResult.payment_status || 'pending'}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Amount Due</span>
                    <strong className="cashier-amount">{formatMoney(lookupAmount, lookupCurrency)}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Customer</span>
                    <strong>{lookupResult.full_name || 'Guest'}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Phone</span>
                    <strong>{lookupResult.phone || 'Not available'}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>License Plate</span>
                    <strong>{lookupResult.license_plate || 'Not available'}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Parking Slot</span>
                    <strong>{lookupResult.slot_id || 'Auto'} / Zone {lookupResult.zone || 'A'}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Entry Time</span>
                    <strong>{formatDateTime(lookupResult.entry_time, 'Not entered yet')}</strong>
                  </div>
                  <div className="cashier-detail-card">
                    <span>Duration</span>
                    <strong>{lookupResult.time_spent_minutes != null ? `${lookupResult.time_spent_minutes} minutes` : 'Reservation window active'}</strong>
                  </div>
                </div>

                <div className="cashier-record">
                  <strong>Vehicle Details:</strong> {lookupResult.metadata?.vehicle_make || 'Vehicle info not provided'} / {lookupResult.metadata?.vehicle_model || 'Model N/A'} / {lookupResult.metadata?.vehicle_color || 'Color N/A'}
                </div>

                {Number(lookupResult.overstay_minutes || 0) > 0 ? (
                  <div className="cashier-alert-row">
                    <TriangleAlert size={18} />
                    <span>
                      Overstay detected: {lookupResult.overstay_minutes} minutes. Additional charge {formatMoney(lookupResult.overstay_amount || 0, lookupCurrency)}.
                    </span>
                  </div>
                ) : null}

                <div className="cashier-action-row">
                  <button type="button" className="cashier-btn cashier-btn-success" onClick={openPaymentModal}>
                    <Wallet size={16} />
                    Process Payment
                  </button>
                  <button type="button" className="cashier-btn cashier-btn-warning" onClick={() => openOperationalRequest('extend')}>
                    <Clock3 size={16} />
                    Extend Duration
                  </button>
                  <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('reservation-meta')}>
                    <ClipboardList size={16} />
                    View Details
                  </button>
                </div>

                {String(lookupResult.payment_status || '').toLowerCase() === 'paid' ? (
                  <div className="cashier-success-card">
                    <CheckCircle2 size={20} />
                    <div>
                      <strong>Payment confirmed</strong>
                      <div>Reservation has been cleared as paid in the cashier portal.</div>
                    </div>
                    <div className="cashier-inline-actions">
                      <button type="button" className="cashier-inline-link" onClick={() => openReceiptModal()}>View Receipt</button>
                      <button type="button" className="cashier-inline-link" onClick={markPending}>Mark Pending</button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="cashier-panel cashier-panel-transactions glass">
              <div className="cashier-panel-head">
                <div>
                  <h2>Today&apos;s Transactions</h2>
                  <p>Filter, review, print, export, and reload cashier transactions.</p>
                </div>
                <div className="cashier-inline-actions">
                  <button type="button" className="cashier-btn cashier-btn-ghost" onClick={loadTransactions}>
                    <RefreshCw size={16} />
                    {loadingTransactions ? 'Loading...' : 'Reload'}
                  </button>
                  <button type="button" className="cashier-btn cashier-btn-ghost" onClick={exportTransactions}>
                    <Download size={16} />
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="cashier-toolbar">
                <input
                  className="cashier-toolbar-input"
                  value={filters.query}
                  placeholder="Filter by code, plate, or customer"
                  onChange={(event) => setFilters((previous) => ({ ...previous, query: event.target.value, page: 1 }))}
                />
                <select value={filters.status} onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value, page: 1 }))}>
                  <option value="all">All Statuses</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                </select>
                <select value={filters.method} onChange={(event) => setFilters((previous) => ({ ...previous, method: event.target.value, page: 1 }))}>
                  <option value="all">All Methods</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="mobile">Mobile</option>
                </select>
                <select value={filters.range} onChange={(event) => setFilters((previous) => ({ ...previous, range: event.target.value, page: 1 }))}>
                  <option value="today">Today</option>
                  <option value="2h">Last 2 Hours</option>
                  <option value="all">All Loaded</option>
                </select>
                <select value={filters.sort} onChange={(event) => setFilters((previous) => ({ ...previous, sort: event.target.value, page: 1 }))}>
                  <option value="recent">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="amount">Highest Amount</option>
                </select>
              </div>

              {filteredTransactions.length === 0 ? (
                <div className="cashier-empty-state">
                  <CreditCard size={34} />
                  <div>No payments recorded for the current filter.</div>
                </div>
              ) : (
                <>
                  <div className="cashier-table-wrap">
                    <table className="cashier-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Confirmation Code</th>
                          <th>Plate</th>
                          <th>Amount</th>
                          <th>Method</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedTransactions.map((item) => (
                          <tr key={item.id}>
                            <td>{formatDateTime(item.paid_at || item.created_at, '—')}</td>
                            <td>{item.confirmation_code || `Reservation #${item.reservation_id}`}</td>
                            <td>{item.license_plate || '—'}</td>
                            <td>{formatMoney(item.amount, item.currency)}</td>
                            <td>{item.payment_method || 'cash'}</td>
                            <td><span className={`cashier-pill ${paymentToneClass(item.status)}`}>{item.status || 'pending'}</span></td>
                            <td>
                              <div className="cashier-table-actions">
                                <button type="button" className="cashier-table-btn" onClick={() => loadSearchEntry({ code: item.confirmation_code, plate: item.license_plate })} title="Load reservation">
                                  <Search size={14} />
                                </button>
                                <button type="button" className="cashier-table-btn" onClick={() => openReceiptModal(item)} title="View receipt">
                                  <Receipt size={14} />
                                </button>
                                <button type="button" className="cashier-table-btn" onClick={() => printReceipt(item)} title="Print receipt">
                                  <FileText size={14} />
                                </button>
                                <button type="button" className="cashier-table-btn" onClick={() => openOperationalRequest('refund', item)} title="Issue refund request">
                                  <TriangleAlert size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="cashier-pagination">
                    <div className="cashier-small-text">
                      Showing {(filters.page - 1) * filters.pageSize + 1}-{Math.min(filters.page * filters.pageSize, filteredTransactions.length)} of {filteredTransactions.length}
                    </div>
                    <div className="cashier-pagination-controls">
                      <select value={filters.pageSize} onChange={(event) => setFilters((previous) => ({ ...previous, pageSize: Number(event.target.value), page: 1 }))}>
                        <option value={10}>10 / page</option>
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                      </select>
                      <button type="button" className="cashier-btn cashier-btn-ghost small" disabled={filters.page === 1} onClick={() => setFilters((previous) => ({ ...previous, page: Math.max(1, previous.page - 1) }))}>
                        Previous
                      </button>
                      <button type="button" className="cashier-btn cashier-btn-ghost small" disabled={filters.page >= totalPages} onClick={() => setFilters((previous) => ({ ...previous, page: Math.min(totalPages, previous.page + 1) }))}>
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="cashier-stack cashier-sidebar">
            <section className="cashier-panel cashier-sidebar-panel glass">
              <div className="cashier-panel-head">
                <div>
                  <h2>Desk Summary</h2>
                  <p>Live cashier desk context and workstation health.</p>
                </div>
              </div>
              <div className="cashier-summary-grid">
                <div className="cashier-summary-item"><span>Cashier</span><strong>{currentUser?.full_name || currentUser?.username || 'Cashier'}</strong></div>
                <div className="cashier-summary-item"><span>Session Length</span><strong>{sessionActive ? formatClock(sessionTime) : 'Stopped'}</strong></div>
                <div className="cashier-summary-item"><span>Scanner Status</span><strong>{scannerStatusText}</strong></div>
                <div className="cashier-summary-item"><span>Payments Today</span><strong>{todayTransactions.length}</strong></div>
                <div className="cashier-summary-item"><span>Total Collected</span><strong>{formatMoney(todayTotal, preferences.currency)}</strong></div>
                <div className="cashier-summary-item"><span>Shift Status</span><strong>{breakEndsAt ? 'Break Active' : (sessionActive ? 'Active' : 'Stopped')}</strong></div>
                <div className="cashier-summary-item wide"><span>Last Transaction</span><strong>{lastTransaction ? `${lastTransaction.confirmation_code || `Reservation #${lastTransaction.reservation_id}`} / ${formatMoney(lastTransaction.amount, lastTransaction.currency)}` : 'N/A'}</strong></div>
              </div>
            </section>

            <section className="cashier-panel cashier-sidebar-panel glass">
              <div className="cashier-panel-head">
                <div>
                  <h2>Quick Actions</h2>
                  <p>Common desk actions for payment, shift, and exceptions.</p>
                </div>
              </div>
              <div className="cashier-quick-grid">
                {[
                  ['new-payment', 'New Payment', Wallet],
                  ['extend', 'Extend Reservation', Clock3],
                  ['refund', 'Issue Refund', TriangleAlert],
                  ['receipt', 'Generate Receipt', Receipt],
                  ['break', breakEndsAt ? 'Resume Session' : 'Take Break', breakEndsAt ? PlayCircle : PauseCircle],
                  ['end-session', 'End Session', X],
                ].map(([id, label, Icon]) => (
                  <button key={id} type="button" className="cashier-quick-card" onClick={() => performQuickAction(id)}>
                    <Icon size={18} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>

      {scannerOpen ? (
        <ModalShell title="Live QR Scanner" icon={ScanLine} subtitle="Point the camera at the reservation QR to auto-fill the lookup." onClose={closeScanner} wide className="cashier-modal-scanner">
          <div className="cashier-scanner-toolbar">
            <div className={`cashier-scanner-status ${scannerError ? 'error' : ''}`}>{scannerError || scannerStatus}</div>
            {cameraDevices.length > 1 ? (
              <select className="cashier-modal-select" value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.target.value)}>
                <option value="">Auto camera</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="cashier-scanner-shell">
            <video ref={videoRef} className="cashier-scanner-video" muted playsInline autoPlay />
            <canvas ref={canvasRef} className="cashier-scanner-canvas" aria-hidden="true" />
            <div className="cashier-scanner-frame" />
          </div>
          <div className="cashier-modal-actions">
            <button type="button" className="cashier-btn cashier-btn-info" onClick={startScanner}>
              <Camera size={16} />
              Restart Scan
            </button>
            <button type="button" className="cashier-btn cashier-btn-primary" onClick={closeScanner}>Close Scanner</button>
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'payment' && lookupResult ? (
        <ModalShell title="Process Payment" icon={Wallet} subtitle="Record a payment and optionally open the receipt immediately." onClose={() => setActiveModal('')} wide>
          <form className="cashier-modal-form" onSubmit={submitPayment}>
            <div className="cashier-modal-grid">
              <div className="cashier-record">
                <strong>Reservation:</strong> {lookupResult.confirmation_code} / {lookupResult.license_plate || 'No plate'} / Slot {lookupResult.slot_id || 'Auto'} / Zone {lookupResult.zone || 'A'}
              </div>
              <label className="cashier-field">
                <span>Payment Method</span>
                <select value={paymentForm.method} onChange={(event) => setPaymentForm((previous) => ({ ...previous, method: event.target.value }))}>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </label>
              <label className="cashier-field">
                <span>Amount Due</span>
                <input type="text" value={formatMoney(lookupAmount, lookupCurrency)} readOnly />
              </label>
              <label className="cashier-field">
                <span>Amount Received</span>
                <input
                  type="number"
                  step="0.01"
                  value={paymentForm.amountReceived}
                  onChange={(event) => setPaymentForm((previous) => ({ ...previous, amountReceived: event.target.value }))}
                />
              </label>
              <label className="cashier-field">
                <span>Change Due</span>
                <input type="text" readOnly value={formatMoney(Math.max(0, Number(paymentForm.amountReceived || 0) - Number(lookupAmount || 0)), lookupCurrency)} />
              </label>
              <label className="cashier-field cashier-field-span">
                <span>Notes</span>
                <textarea
                  rows={4}
                  value={paymentForm.notes}
                  onChange={(event) => setPaymentForm((previous) => ({ ...previous, notes: event.target.value }))}
                  placeholder="Desk note or discrepancy details"
                />
              </label>
              <label className="cashier-checkbox">
                <input
                  type="checkbox"
                  checked={paymentForm.printReceipt}
                  onChange={(event) => setPaymentForm((previous) => ({ ...previous, printReceipt: event.target.checked }))}
                />
                <span>Open receipt immediately after payment is confirmed</span>
              </label>
            </div>
            <div className="cashier-modal-actions">
              <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('')}>Cancel</button>
              <button type="submit" className="cashier-btn cashier-btn-success" disabled={loadingPayment}>
                {loadingPayment ? 'Processing...' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {activeModal === 'bug' ? (
        <ModalShell title="Report a Bug" icon={Bug} subtitle="Send a workstation issue directly to the admin queue." onClose={() => setActiveModal('')} wide>
          <form className="cashier-modal-form" onSubmit={handleBugSubmit}>
            <div className="cashier-modal-grid two">
              <label className="cashier-field">
                <span>Bug Title</span>
                <input value={bugForm.title} onChange={(event) => setBugForm((previous) => ({ ...previous, title: event.target.value }))} />
              </label>
              <label className="cashier-field">
                <span>Severity</span>
                <select value={bugForm.severity} onChange={(event) => setBugForm((previous) => ({ ...previous, severity: event.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
            </div>
            <label className="cashier-field">
              <span>Description</span>
              <textarea rows={4} value={bugForm.description} onChange={(event) => setBugForm((previous) => ({ ...previous, description: event.target.value }))} />
            </label>
            <label className="cashier-field">
              <span>Steps to Reproduce</span>
              <textarea rows={4} value={bugForm.steps} onChange={(event) => setBugForm((previous) => ({ ...previous, steps: event.target.value }))} />
            </label>
            <div className="cashier-modal-grid two">
              <label className="cashier-field">
                <span>Email</span>
                <input type="email" value={bugForm.email} onChange={(event) => setBugForm((previous) => ({ ...previous, email: event.target.value }))} />
              </label>
              <label className="cashier-field">
                <span>Attach Screenshots</span>
                <input type="file" multiple onChange={(event) => setBugForm((previous) => ({ ...previous, screenshots: Array.from(event.target.files || []) }))} />
              </label>
            </div>
            <div className="cashier-record"><strong>Device Info:</strong> {typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}</div>
            <div className="cashier-modal-actions">
              <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('')}>Cancel</button>
              <button type="submit" className="cashier-btn cashier-btn-primary">Submit Bug</button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {activeModal === 'support' ? (
        <ModalShell title="Contact Support" icon={LifeBuoy} subtitle="Submit a support request from the cashier workstation." onClose={() => setActiveModal('')}>
          <form className="cashier-modal-form" onSubmit={handleSupportSubmit}>
            <label className="cashier-field">
              <span>Subject</span>
              <input value={supportForm.subject} onChange={(event) => setSupportForm((previous) => ({ ...previous, subject: event.target.value }))} />
            </label>
            <label className="cashier-field">
              <span>Message</span>
              <textarea rows={5} value={supportForm.message} onChange={(event) => setSupportForm((previous) => ({ ...previous, message: event.target.value }))} />
            </label>
            <label className="cashier-field">
              <span>Contact Email</span>
              <input value={supportForm.email} onChange={(event) => setSupportForm((previous) => ({ ...previous, email: event.target.value }))} />
            </label>
            <div className="cashier-modal-actions">
              <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('')}>Cancel</button>
              <button type="submit" className="cashier-btn cashier-btn-primary">Send Request</button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {activeModal === 'guide' ? (
        <ModalShell title="Quick Start Guide" icon={BookOpen} subtitle="Core cashier workflow from lookup to payment." onClose={() => setActiveModal('')}>
          <ol className="cashier-ordered-list">
            {QUICK_START_STEPS.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </ModalShell>
      ) : null}

      {activeModal === 'faq' ? (
        <ModalShell title="Cashier FAQ" icon={HelpCircle} subtitle="Common desk questions and operational answers." onClose={() => setActiveModal('')} wide>
          <div className="cashier-accordion">
            {FAQ_ITEMS.map((item, index) => (
              <button key={item.question} type="button" className="cashier-accordion-item" onClick={() => setActiveFaq(index)}>
                <div className="cashier-accordion-question">{item.question}</div>
                {activeFaq === index ? <div className="cashier-accordion-answer">{item.answer}</div> : null}
              </button>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'shortcuts' ? (
        <ModalShell title="Keyboard Shortcuts" icon={Keyboard} subtitle="Operate the cashier workstation quickly from the keyboard." onClose={() => setActiveModal('')}>
          <div className="cashier-shortcuts-list">
            {SHORTCUTS.map(([shortcut, meaning]) => (
              <div key={shortcut} className="cashier-shortcut-row">
                <kbd>{shortcut}</kbd>
                <span>{meaning}</span>
              </div>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'docs' ? (
        <ModalShell title="Documentation" icon={FileText} subtitle="Cashier operating reference for real desk use." onClose={() => setActiveModal('')} wide>
          <div className="cashier-docs-grid">
            {DOC_SECTIONS.map((section) => (
              <div key={section.title} className="cashier-record">
                <strong>{section.title}</strong>
                <div>{section.body}</div>
              </div>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'profile' ? (
        <ModalShell title="My Profile" icon={User} subtitle="Current cashier identity and shift context." onClose={() => setActiveModal('')}>
          <div className="cashier-profile-card">
            <div className="cashier-avatar large">{(currentUser?.username || 'C').slice(0, 1).toUpperCase()}</div>
            <div>
              <h4>{currentUser?.full_name || currentUser?.username || 'Cashier'}</h4>
              <p>{currentUser?.username || 'cashier'} / {currentUser?.role || 'cashier'}</p>
            </div>
          </div>
          <div className="cashier-summary-grid">
            <div className="cashier-summary-item"><span>Username</span><strong>{currentUser?.username || 'cashier'}</strong></div>
            <div className="cashier-summary-item"><span>Role</span><strong>{currentUser?.role || 'cashier'}</strong></div>
            <div className="cashier-summary-item"><span>Session Length</span><strong>{sessionActive ? formatClock(sessionTime) : 'Stopped'}</strong></div>
            <div className="cashier-summary-item"><span>Shift</span><strong>{shift.label} / {shift.name}</strong></div>
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'change-password' ? (
        <ModalShell title="Change Password" icon={ShieldCheck} subtitle="Update the current cashier account password." onClose={() => setActiveModal('')}>
          <form className="cashier-modal-form" onSubmit={handleChangePasswordSubmit}>
            <label className="cashier-field">
              <span>Current Password</span>
              <input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((previous) => ({ ...previous, currentPassword: event.target.value }))} />
            </label>
            <label className="cashier-field">
              <span>New Password</span>
              <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((previous) => ({ ...previous, newPassword: event.target.value }))} />
            </label>
            <label className="cashier-field">
              <span>Confirm New Password</span>
              <input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((previous) => ({ ...previous, confirmPassword: event.target.value }))} />
            </label>
            <div className="cashier-modal-actions">
              <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('')}>Cancel</button>
              <button type="submit" className="cashier-btn cashier-btn-primary">Update Password</button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {activeModal === 'preferences' ? (
        <ModalShell title="Preferences" icon={Settings2} subtitle="Display, notification, and scanner preferences." onClose={() => setActiveModal('')} wide className="cashier-modal-preferences">
          <div className="cashier-modal-grid two">
            <label className="cashier-field">
              <span>Theme</span>
              <select value={preferences.theme} onChange={(event) => setPreferences((previous) => ({ ...previous, theme: event.target.value }))}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label className="cashier-field">
              <span>Language</span>
              <select value={preferences.language} onChange={(event) => setPreferences((previous) => ({ ...previous, language: event.target.value }))}>
                <option value="English">English</option>
                <option value="Arabic">Arabic</option>
                <option value="Chinese">Chinese</option>
              </select>
            </label>
            <label className="cashier-field">
              <span>Font Size</span>
              <select value={preferences.fontScale} onChange={(event) => setPreferences((previous) => ({ ...previous, fontScale: event.target.value }))}>
                <option value="compact">Compact</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
              </select>
            </label>
            <label className="cashier-field">
              <span>Currency</span>
              <select value={preferences.currency} onChange={(event) => setPreferences((previous) => ({ ...previous, currency: event.target.value }))}>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </select>
            </label>
            <label className="cashier-field">
              <span>Scanner Sensitivity</span>
              <select value={preferences.scannerSensitivity} onChange={(event) => setPreferences((previous) => ({ ...previous, scannerSensitivity: event.target.value }))}>
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="precise">Precise</option>
              </select>
            </label>
            <div className="cashier-field">
              <span>Notifications</span>
              <label className="cashier-checkbox">
                <input type="checkbox" checked={preferences.notificationsEnabled} onChange={(event) => setPreferences((previous) => ({ ...previous, notificationsEnabled: event.target.checked }))} />
                <span>Enable toast notifications</span>
              </label>
              <label className="cashier-checkbox">
                <input type="checkbox" checked={preferences.soundEnabled} onChange={(event) => setPreferences((previous) => ({ ...previous, soundEnabled: event.target.checked }))} />
                <span>Enable sound notifications</span>
              </label>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'activity' ? (
        <ModalShell title="Activity Log" icon={History} subtitle="Recent searches and transaction activity on this desk." onClose={() => setActiveModal('')} wide>
          <div className="cashier-activity-list">
            {[
              ...recentSearches.map((item) => ({ id: `search-${item.id}`, label: `Searched ${item.code || item.plate}`, time: item.time })),
              ...transactions.slice(0, 8).map((item) => ({ id: `tx-${item.id}`, label: `${item.payment_method || 'payment'} ${item.status} for ${item.confirmation_code || item.reservation_id}`, time: item.paid_at || item.created_at })),
            ].sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()).map((item) => (
              <div key={item.id} className="cashier-activity-item">
                <strong>{item.label}</strong>
                <span>{formatDateTime(item.time)}</span>
              </div>
            ))}
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'receipt' && receiptTransaction ? (
        <ModalShell title="Receipt Preview" icon={Receipt} subtitle="Review or print the generated cashier receipt." onClose={() => setActiveModal('')} wide>
          <div className="cashier-receipt-card">
            <div className="cashier-receipt-row"><span>Confirmation Code</span><strong>{receiptTransaction.confirmation_code || '—'}</strong></div>
            <div className="cashier-receipt-row"><span>Customer</span><strong>{receiptTransaction.full_name || 'Guest'}</strong></div>
            <div className="cashier-receipt-row"><span>Plate</span><strong>{receiptTransaction.license_plate || '—'}</strong></div>
            <div className="cashier-receipt-row"><span>Slot / Zone</span><strong>{receiptTransaction.slot_id || 'Auto'} / {receiptTransaction.zone || 'A'}</strong></div>
            <div className="cashier-receipt-row"><span>Payment Method</span><strong>{receiptTransaction.payment_method || 'cash'}</strong></div>
            <div className="cashier-receipt-row"><span>Amount</span><strong>{formatMoney(receiptTransaction.amount, receiptTransaction.currency)}</strong></div>
            <div className="cashier-receipt-row"><span>Amount Received</span><strong>{receiptTransaction.amount_received != null ? formatMoney(receiptTransaction.amount_received, receiptTransaction.currency) : '—'}</strong></div>
            <div className="cashier-receipt-row"><span>Change Due</span><strong>{receiptTransaction.change_due != null ? formatMoney(receiptTransaction.change_due, receiptTransaction.currency) : '—'}</strong></div>
            <div className="cashier-receipt-row"><span>Processed At</span><strong>{formatDateTime(receiptTransaction.paid_at || receiptTransaction.created_at)}</strong></div>
          </div>
          <div className="cashier-modal-actions">
            <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('')}>Close</button>
            <button type="button" className="cashier-btn cashier-btn-primary" onClick={() => printReceipt(receiptTransaction)}>Print Receipt</button>
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'shift-summary' ? (
        <ModalShell title="Shift Summary" icon={ClipboardList} subtitle="Operational summary for the cashier shift." onClose={() => setActiveModal('')} wide>
          <div className="cashier-summary-grid">
            <div className="cashier-summary-item"><span>Total Transactions</span><strong>{todayTransactions.length}</strong></div>
            <div className="cashier-summary-item"><span>Total Collected</span><strong>{formatMoney(todayTotal, preferences.currency)}</strong></div>
            <div className="cashier-summary-item"><span>Cash Payments</span><strong>{todayTransactions.filter((item) => item.payment_method === 'cash').length}</strong></div>
            <div className="cashier-summary-item"><span>Card / Mobile</span><strong>{todayTransactions.filter((item) => item.payment_method !== 'cash').length}</strong></div>
          </div>
          <div className="cashier-modal-actions">
            <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('')}>Close</button>
            <button type="button" className="cashier-btn cashier-btn-primary" onClick={exportTransactions}>Export Shift Report</button>
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'reservation-meta' && lookupResult ? (
        <ModalShell title="Reservation Details" icon={ClipboardList} subtitle="Expanded reservation and customer quick info." onClose={() => setActiveModal('')} wide>
          <div className="cashier-summary-grid">
            <div className="cashier-summary-item"><span>Preferred Payment</span><strong>{lookupResult.payment_method || 'cash'}</strong></div>
            <div className="cashier-summary-item"><span>Loyalty Status</span><strong>Standard Visitor</strong></div>
            <div className="cashier-summary-item"><span>Parking History</span><strong>Recent history not available in this build</strong></div>
            <div className="cashier-summary-item"><span>Contact</span><strong>{lookupResult.phone || lookupResult.email || 'Not available'}</strong></div>
          </div>
        </ModalShell>
      ) : null}

      {activeModal === 'request' ? (
        <ModalShell
          title={requestForm.type === 'refund' ? 'Refund Request' : 'Extension Request'}
          icon={requestForm.type === 'refund' ? TriangleAlert : Clock3}
          subtitle="Submit an operational request to the admin issue queue."
          onClose={() => setActiveModal('')}
          wide
        >
          <form className="cashier-modal-form" onSubmit={handleOperationalRequestSubmit}>
            <div className="cashier-modal-grid two">
              <label className="cashier-field">
                <span>Request Title</span>
                <input value={requestForm.title} onChange={(event) => setRequestForm((previous) => ({ ...previous, title: event.target.value }))} />
              </label>
              <label className="cashier-field">
                <span>Priority</span>
                <select value={requestForm.priority} onChange={(event) => setRequestForm((previous) => ({ ...previous, priority: event.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
            </div>
            <label className="cashier-field">
              <span>Details</span>
              <textarea rows={8} value={requestForm.description} onChange={(event) => setRequestForm((previous) => ({ ...previous, description: event.target.value }))} />
            </label>
            <div className="cashier-modal-actions">
              <button type="button" className="cashier-btn cashier-btn-ghost" onClick={() => setActiveModal('')}>Cancel</button>
              <button type="submit" className="cashier-btn cashier-btn-primary">Submit Request</button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </div>
  );
};

export default CashierDashboard;
