import React, { useEffect, useState } from 'react';
import Header from './components/Header';
import Dashboard from './components/pages/Dashboard';
import SlotEditor from './components/pages/SlotEditor';
import AnalyticsPage from './components/pages/AnalyticsPage';
import LPRPage from './components/pages/LPRPage';
import RevenuePage from './components/pages/RevenuePage';
import AlertsPage from './components/pages/AlertsPage';
import SettingsPage from './components/pages/SettingsPage';
import { useWebSocket } from './hooks/useWebSocket';

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard');
  const [feedState, setFeedState] = useState({ mode: 'none', source: null, token: 0 });
  const { status: wsStatus, data: wsData } = useWebSocket();
  const [activeAlert, setActiveAlert] = useState(null);

  // Show latest alert as a dismissing banner.
  useEffect(() => {
    if (!wsData?.alerts?.length) return;
    const last = wsData.alerts[wsData.alerts.length - 1];
    if (last?.type !== 'alert') return;
    setActiveAlert(last);
    const t = setTimeout(() => setActiveAlert(null), 10_000);
    return () => clearTimeout(t);
  }, [wsData?.alerts]);

  const wsConnected = wsStatus === 'connected';
  const wsReconnecting = wsStatus === 'disconnected' || wsStatus === 'connecting' || wsStatus === 'error';

  return (
    <>
      <Header
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        wsConnected={wsConnected}
      />
      {wsReconnecting && (
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
      <div style={{ marginTop: '80px' }}>
        {currentPage === 'Dashboard' && (
          <Dashboard
            feedState={feedState}
            setFeedState={setFeedState}
            wsStatus={wsStatus}
            wsData={wsData}
          />
        )}
        {currentPage === 'SlotEditor' && <SlotEditor />}
        {currentPage === 'Analytics' && <AnalyticsPage />}
        {currentPage === 'LPR' && <LPRPage />}
        {currentPage === 'Revenue' && <RevenuePage />}
        {currentPage === 'Alerts' && <AlertsPage />}
        {currentPage === 'Settings' && <SettingsPage />}
      </div>
    </>
  );
}

export default App;
