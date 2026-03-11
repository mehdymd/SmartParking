import React, { useState } from 'react';
import Header from './components/Header';
import Dashboard from './components/pages/Dashboard';
import SlotEditor from './components/pages/SlotEditor';
import AnalyticsPage from './components/pages/AnalyticsPage';
import LPRPage from './components/pages/LPRPage';
import RevenuePage from './components/pages/RevenuePage';
import AlertsPage from './components/pages/AlertsPage';
import SettingsPage from './components/pages/SettingsPage';

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard');
  const [uploadedSrc, setUploadedSrc] = useState(null);

  return (
    <>
      <Header currentPage={currentPage} setCurrentPage={setCurrentPage} />
      <div style={{ marginTop: '80px' }}>
        {currentPage === 'Dashboard' && (
          <Dashboard
            uploadedSrc={uploadedSrc}
            onUpload={setUploadedSrc}
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
