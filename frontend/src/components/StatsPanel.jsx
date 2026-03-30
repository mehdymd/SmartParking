import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../lib/api';

const StatsPanel = ({ wsStatus = 'disconnected', liveStats = null }) => {
  const [fallbackStats, setFallbackStats] = useState(null);

  useEffect(() => {
    if (wsStatus === 'connected') return;
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const response = await fetch(apiUrl('/parking/stats'));
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setFallbackStats(data);
        }
      } catch {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [wsStatus]);

  const stats = useMemo(() => {
    const s = liveStats && Object.keys(liveStats).length ? liveStats : fallbackStats;
    return s || {};
  }, [liveStats, fallbackStats]);

  const occupancyRatePct = useMemo(() => {
    const v = Number(stats.occupancy_rate ?? 0);
    if (Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(100, v));
  }, [stats.occupancy_rate]);

  const getGaugeColor = (rate) => {
    if (rate < 60) return 'var(--green)';
    if (rate < 85) return 'var(--amber)';
    return 'var(--red)';
  };

  const total = stats.total ?? 0;
  const available = stats.available ?? 0;
  const occupied = stats.occupied ?? 0;
  const reserved = stats.reserved ?? 0;
  const rateColor = getGaugeColor(occupancyRatePct);
  const pct = Math.round(occupancyRatePct);

  return (
    <div className="glass" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Real-time Statistics</h2>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {wsStatus === 'connected' ? 'Live' : 'Polling'}
        </span>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '12px' }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Total</div>
          <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>{total}</div>
        </div>
        <div style={{ background: 'rgba(46,204,113,0.08)', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#6dcea6', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Available</div>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#2ECC71' }}>{available}</div>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#e88', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Occupied</div>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#EF4444' }}>{occupied}</div>
        </div>
        <div style={{ background: 'rgba(245,158,11,0.10)', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#ffd383', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Reserved</div>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#F59E0B' }}>{reserved}</div>
        </div>
        <div style={{ background: `${rateColor}12`, borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Rate</div>
          <div style={{ fontSize: '22px', fontWeight: '700', color: rateColor }}>{pct}%</div>
        </div>
      </div>

      {/* Occupancy bar */}
      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '4px',
          background: rateColor,
          transition: 'width 0.4s ease'
        }} />
      </div>
    </div>
  );
};

export default StatsPanel;
