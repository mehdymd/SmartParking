import React, { useState } from 'react';
import Header from './components/Header';
import Dashboard from './components/pages/Dashboard';
import AnalyticsPage from './components/pages/AnalyticsPage';
import LPRPage from './components/pages/LPRPage';
import RevenuePage from './components/pages/RevenuePage';
import AlertsPage from './components/pages/AlertsPage';
import SettingsPage from './components/pages/SettingsPage';

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard');
// eslint-disable-next-line no-unused-vars
  const [uploadedVideoSrc, setUploadedVideoSrc] = useState(null);

  return (
    <>
      <Header currentPage={currentPage} setCurrentPage={setCurrentPage} />
      {currentPage === 'Dashboard' && <Dashboard uploadedSrc={uploadedVideoSrc} />}
      {currentPage === 'Analytics' && <AnalyticsPage />}
      {currentPage === 'LPR' && <LPRPage />}
      {currentPage === 'Revenue' && <RevenuePage />}
      {currentPage === 'Alerts' && <AlertsPage />}
      {currentPage === 'Settings' && <SettingsPage />}
    </>
  );
}

export default App;
