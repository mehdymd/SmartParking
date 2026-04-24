import React, { useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import Dashboard from './components/pages/Dashboard';
import SlotEditor from './components/pages/SlotEditor';
import AnalyticsPage from './components/pages/AnalyticsPage';
import LPRPage from './components/pages/LPRPage';
import RevenuePage from './components/pages/RevenuePage';
import AlertsPage from './components/pages/AlertsPage';
import SettingsPage from './components/pages/SettingsPage';
import LoginPage from './components/pages/LoginPage';
import ReservationsPage from './components/pages/ReservationsPage';
import IncidentsPage from './components/pages/IncidentsPage';
import MobilePortal from './components/pages/MobilePortal';
import MobileLogin from './components/pages/MobileLogin';
import UsersPage from './components/pages/UsersPage';
import CashierDashboard from './components/pages/CashierDashboard';
import { authFetch, loadAuth, saveAuth } from './lib/auth';
import { mobileAuth, wsUrl } from './lib/api';

function App() {
  const initialParams = new URLSearchParams(window.location.search);
  const [currentPage, setCurrentPage] = useState(initialParams.get('page') || 'Dashboard');
  const [portalMode] = useState(initialParams.get('portal') || '');
  const [feedState, setFeedState] = useState({ mode: 'none', source: null, token: 0, activeCameraId: null, cameras: [] });
  const [activeAlert] = useState(null);
  const [auth, setAuth] = useState(() => loadAuth());
  const [authReady, setAuthReady] = useState(false);

  const currentUser = auth?.user || null;
  const token = auth?.token || null;
  const [wsData, setWsData] = useState({ status: {}, stats: {}, alerts: [] });
  const [wsConnected, setWsConnected] = useState(false);
  const [wsReconnecting, setWsReconnecting] = useState(false);
  const wsStatus = wsConnected ? 'connected' : 'disconnected';

  useEffect(() => {
    const wsTarget = wsUrl('/ws/parking-updates');
    let ws = null;
    let reconnectTimer = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsTarget);
      } catch {
        setWsConnected(false);
        return;
      }

      ws.onopen = () => {
        setWsConnected(true);
        setWsReconnecting(false);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'update') {
            setWsData({
              status: msg.status || {},
              stats: msg.stats || {},
              alerts: [],
            });
          }
        } catch {}
      };

      ws.onclose = () => {
        setWsConnected(false);
        ws = null;
        reconnectTimer = setTimeout(connect, 3000);
        setWsReconnecting(true);
      };

      ws.onerror = () => {
        if (ws) {
          ws.close();
          ws = null;
        }
      };
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const allowedPages = useMemo(() => {
    const role = currentUser?.role || 'user';
    if (role === 'cashier') {
      return ['CashierDashboard'];
    }
    return [
      'Dashboard',
      'Reservations',
      'Incidents',
      'Analytics',
      'Revenue',
      'Alerts',
      ...(role !== 'user' ? ['SlotEditor'] : []),
      ...(role === 'admin' ? ['Settings', 'Users'] : []),
      ...(role === 'cashier' ? ['Users'] : []),
      'LPR',
    ];
  }, [currentUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPage = params.get('page');
    if (requestedPage) {
      setCurrentPage(requestedPage);
    }
  }, []);

  useEffect(() => {
    if (!allowedPages.includes(currentPage)) {
      const role = currentUser?.role || 'user';
      setCurrentPage(role === 'cashier' ? 'CashierDashboard' : 'Dashboard');
    }
  }, [allowedPages, currentPage, currentUser?.role]);

  useEffect(() => {
    const validate = async () => {
      if (!token) {
        setAuthReady(true);
        return;
      }

      try {
        const response = await authFetch('/auth/me', {}, token);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Session expired');
        const nextAuth = { token, user: payload.user };
        setAuth(nextAuth);
        saveAuth(nextAuth);
        const role = payload.user?.role || 'user';
        setCurrentPage(role === 'cashier' ? 'CashierDashboard' : 'Dashboard');
      } catch {
        setAuth(null);
        saveAuth(null);
      } finally {
        setAuthReady(true);
      }
    };

    validate();
  }, [token]);

  const handleLogin = (payload) => {
    saveAuth(payload);
    setAuth(payload);
    const role = payload.user?.role || 'user';
    setCurrentPage(role === 'cashier' ? 'CashierDashboard' : 'Dashboard');
    setAuthReady(true);
  };

  const handleLogout = () => {
    saveAuth(null);
    setAuth(null);
    setCurrentPage('Dashboard');
  };

  const [mobileTab, setMobileTab] = useState('dashboard');
  const [mobileUser, setMobileUser] = useState(() => mobileAuth.getUser());
  const [mobileAuthReady, setMobileAuthReady] = useState(false);

  useEffect(() => {
    const token = mobileAuth.getToken();
    if (token) {
      setMobileAuthReady(true);
    } else {
      setMobileAuthReady(true);
    }
  }, []);

  const handleMobileLogin = (user) => {
    setMobileUser(user);
  };

  const handleMobileLogout = () => {
    mobileAuth.logout();
    setMobileUser(null);
    setMobileTab('dashboard');
  };

  if (portalMode === 'access') {
    if (!mobileAuthReady) {
      return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Loading...</div>;
    }

    if (!mobileUser) {
      return <MobileLogin onLogin={handleMobileLogin} />;
    }

    return <MobilePortal activeTab={mobileTab} onTabChange={setMobileTab} user={mobileUser} onLogout={handleMobileLogout} />;
  }

  if (!authReady) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-primary)' }}>Loading...</div>;
  }

  if (!currentUser || !token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <>
      {currentPage !== 'CashierDashboard' && (
        <Header
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          wsConnected={wsConnected}
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}
      {currentPage !== 'CashierDashboard' && wsReconnecting && currentUser && (
        <div style={{
          position: 'fixed',
          top: '80px',
          left: 0,
          right: 0,
          zIndex: 999,
          background: '#fff3cd',
          borderBottom: '1px solid #ffeeba',
          color: '#856404',
          padding: '8px 16px',
          fontSize: '13px',
          textAlign: 'center'
        }}>
          Reconnecting…
        </div>
      )}
      {activeAlert && (
        <div style={{
          position: 'fixed',
          top: wsReconnecting ? '116px' : '80px',
          left: '16px',
          right: '16px',
          zIndex: 1000,
          background: '#f8d7da',
          border: '1px solid #f5c6cb',
          color: '#721c24',
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          {activeAlert.message}
        </div>
      )}
      <div style={{ marginTop: currentPage === 'CashierDashboard' ? 0 : '80px' }}>
        {currentPage === 'Dashboard' && (
          <Dashboard
            feedState={feedState}
            setFeedState={setFeedState}
            wsStatus={wsStatus}
            wsData={wsData}
            token={token}
            currentUser={currentUser}
          />
        )}
        {currentPage === 'Reservations' && <ReservationsPage token={token} user={currentUser} />}
        {currentPage === 'Incidents' && <IncidentsPage token={token} user={currentUser} />}
        {currentPage === 'SlotEditor' && <SlotEditor />}
        {currentPage === 'Analytics' && <AnalyticsPage />}
        {currentPage === 'LPR' && <LPRPage />}
        {currentPage === 'Revenue' && <RevenuePage />}
        {currentPage === 'Alerts' && <AlertsPage />}
        {currentPage === 'Settings' && <SettingsPage token={token} />}
        {currentPage === 'Users' && <UsersPage currentUser={currentUser} />}
        {currentPage === 'CashierDashboard' && <CashierDashboard currentUser={currentUser} token={token} onLogout={handleLogout} />}
      </div>
    </>
  );
}

export default App;
