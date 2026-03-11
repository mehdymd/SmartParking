import React, { useState } from 'react';
import LiveFeed from '../LiveFeed';
import StatsPanel from '../StatsPanel';
import ActivityLog from '../ActivityLog';
import Controls from '../Controls';
import NavigationMap from '../NavigationMap';
import AnalyticsSection from '../AnalyticsSection';
import SessionsTable from '../SessionsTable';

const Dashboard = ({ uploadedSrc, onUpload, wsStatus, wsData }) => {
  const [cameraOn, setCameraOn] = useState(false);
  return (
    <div style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '100px 30px 30px 30px',
      display: 'grid',
      gridTemplateColumns: '65fr 35fr',
      gap: 'var(--gap)',
      boxSizing: 'border-box'
    }}>
      {/* Left Column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
        {/* Live Feed Panel */}
        <LiveFeed uploadedSrc={uploadedSrc} cameraOn={cameraOn} />

        {/* Recent Activity Panel */}
        <ActivityLog />
      </div>

      {/* Right Column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
        {/* Real-time Stats Panel */}
        <StatsPanel wsStatus={wsStatus} liveStats={wsData?.stats} />

        {/* Controls Panel */}
        <Controls
          onUpload={onUpload}
          cameraOn={cameraOn}
          setCameraOn={setCameraOn}
          hasUploaded={!!uploadedSrc}
        />

        {/* Sessions */}
        <SessionsTable />
      </div>

      {/* Full-width Navigation Map */}
      <NavigationMap />

      {/* Full-width Analytics Overview */}
      <AnalyticsSection />
    </div>
  );
};

export default Dashboard;
