import React, { useState } from 'react';

const AnalyticsSection = () => {
  const [range, setRange] = useState('24H');

  const ranges = ['1H', '6H', '24H', '7D'];

  return (
    <div className="glass" style={{ padding: '20px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Analytics Overview</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {ranges.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: '6px 12px',
                borderRadius: '16px',
                border: 'none',
                backgroundColor: range === r ? 'var(--blue)' : 'transparent',
                color: range === r ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Occupancy Over Time</h3>
          <div style={{ height: '200px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Line Chart Placeholder
          </div>
        </div>

        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Peak Hours</h3>
          <div style={{ height: '200px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Bar Chart Placeholder
          </div>
        </div>

        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Zone Breakdown</h3>
          <div style={{ height: '200px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Doughnut Chart Placeholder
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsSection;
