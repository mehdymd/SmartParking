import React, { useState, useEffect } from 'react';

const StatsPanel = () => {
  const [stats, setStats] = useState({});
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 1000); // Update every second
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/parking/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data);
      setLastUpdated(new Date());
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch stats', err);
      setLoading(false);
    }
  };

  const getTimeAgo = () => {
    const now = new Date();
    const diff = Math.floor((now - lastUpdated) / 1000);
    if (diff < 60) return `${diff}s ago`;
    const min = Math.floor(diff / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.floor(min / 60);
    return `${hour}h ago`;
  };

  const getGaugeColor = (rate) => {
    if (rate < 60) return 'var(--green)';
    if (rate < 85) return 'var(--amber)';
    return 'var(--red)';
  };

  const CircularGauge = ({ value, size = 80 }) => {
    const radius = size / 2 - 10;
    const circumference = 2 * Math.PI * radius;
    const strokeWidth = 8;
    const progress = (value / 100) * circumference;
    return (
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#444"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#gradient)`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--blue)" />
            <stop offset="100%" stopColor="var(--green)" />
          </linearGradient>
        </defs>
      </svg>
    );
  };

  if (loading) {
    return (
      <div className="glass" style={{ padding: '20px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading parking data...
      </div>
    );
  }

  if (stats.total === 0) {
    return (
      <div className="glass" style={{ padding: '20px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>No Parking Data Available</div>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Upload a video to start monitoring parking spaces.</div>
      </div>
    );
  }

  return (
    <div className="glass" style={{ padding: '20px', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Real-time Statistics</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Updated {getTimeAgo()}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
        <div className="glass" style={{ padding: '20px', borderRadius: '8px' }}>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>Total Spaces</div>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>{stats.total === 0 ? 'No data' : stats.total}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Across 3 zones</div>
        </div>

        <div style={{ background: 'linear-gradient(135deg, var(--green), var(--green-dark))', padding: '20px', borderRadius: '8px' }}>
          <div style={{ fontSize: '14px', color: '#fff', marginBottom: '8px' }}>Available</div>
          <div style={{ fontSize: '36px', fontWeight: '700', color: '#fff' }}>{stats.total === 0 ? 'No data' : stats.available}</div>
          <div style={{ fontSize: '12px', color: '#d4edda' }}>▲ 5 since last hour</div>
        </div>

        <div style={{ background: 'linear-gradient(135deg, var(--red), var(--red-dark))', padding: '20px', borderRadius: '8px' }}>
          <div style={{ fontSize: '14px', color: '#fff', marginBottom: '8px' }}>Occupied</div>
          <div style={{ fontSize: '36px', fontWeight: '700', color: '#fff' }}>{stats.total === 0 ? 'No data' : stats.occupied}</div>
          <div style={{ fontSize: '12px', color: '#f8d7da' }}>▼ 3 since last hour</div>
        </div>

        <div className="glass" style={{ padding: '20px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>Occupancy Rate</div>
            <div style={{ fontSize: '36px', fontWeight: '700', color: getGaugeColor((stats.occupancy_rate || 0) * 100) }}>{stats.total === 0 ? 'No data' : Math.round((stats.occupancy_rate || 0) * 100) + '%'}</div>
          </div>
          <CircularGauge value={(stats.occupancy_rate || 0) * 100} />
        </div>
      </div>

      <div style={{ height: '80px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Sparkline Placeholder
      </div>
    </div>
  );
};

export default StatsPanel;
