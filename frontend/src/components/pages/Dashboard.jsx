import React from 'react';
import LiveFeed from '../LiveFeed';
import StatsPanel from '../StatsPanel';
import ActivityLog from '../ActivityLog';
import Controls from '../Controls';
import AnalyticsSection from '../AnalyticsSection';
import SessionsTable from '../SessionsTable';

const Dashboard = ({ feedState, setFeedState, wsStatus, wsData }) => {
  return (
    <div style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '90px 24px 24px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      boxSizing: 'border-box'
    }}>
      {/* Top row: Live Feed + Stats & Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        <LiveFeed feedState={feedState} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <StatsPanel wsStatus={wsStatus} liveStats={wsData?.stats} />
          <Controls
            feedState={feedState}
            setFeedState={setFeedState}
          />
        </div>
      </div>

      {/* Activity + Sessions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <ActivityLog />
        <SessionsTable />
      </div>

      {/* Analytics */}
      <AnalyticsSection />
    </div>
  );
};

export default Dashboard;
