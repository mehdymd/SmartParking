import React, { useState, useEffect } from 'react';

const AnalyticsPage = () => {
  const [heatmap, setHeatmap] = useState({});
  const [range, setRange] = useState('30d');
  const [dwellSummary, setDwellSummary] = useState({});
  const [tooltip, setTooltip] = useState('');
  const [stats, setStats] = useState({});

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    const response = await fetch('http://localhost:8000/parking/stats');
    const data = await response.json();
    setStats(data);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchHeatmap();
  }, [range]);

  useEffect(() => {
    fetchDwellSummary();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const interval = setInterval(() => {
      fetchHeatmap();
      fetchDwellSummary();
    }, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, [range]);

  const fetchHeatmap = async () => {
    const response = await fetch(`http://localhost:8000/analytics/heatmap?range=${range}`);
    const data = await response.json();
    setHeatmap(data.matrix || {});
  };

  const fetchDwellSummary = async () => {
    const response = await fetch('http://localhost:8000/analytics/dwell');
    const data = await response.json();
    setDwellSummary(data);
  };

  const getColor = (value) => {
    if (value < 0.25) return '#1a3a1a';
    if (value < 0.5) return '#2ECC71';
    if (value < 0.75) return '#F59E0B';
    return '#EF4444';
  };

  const zones = Object.keys(heatmap);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const computeStats = () => {
    if (!zones.length) return { busiestZone: '', peakHour: '', quietestPeriod: '' };
    const busiestZone = zones.reduce((a, b) => (sum(heatmap[a]) / 24 > sum(heatmap[b]) / 24 ? a : b));
    const avgPerHour = hours.map(h => sum(zones.map(z => heatmap[z][h])) / zones.length);
    const peakHour = hours[avgPerHour.indexOf(Math.max(...avgPerHour))];
    const quietestPeriod = hours[avgPerHour.indexOf(Math.min(...avgPerHour))];
    return {
      busiestZone: `${busiestZone} — avg ${(sum(heatmap[busiestZone]) / 24 * 100).toFixed(0)}%`,
      peakHour: `${peakHour}PM — avg ${(avgPerHour[peakHour] * 100).toFixed(0)}%`,
      quietestPeriod: `${quietestPeriod}AM — avg ${(avgPerHour[quietestPeriod] * 100).toFixed(0)}%`
    };
  };

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  const computedStats = computeStats();

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {stats.total === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>No Analytics Data Available</h1>
            <p style={{ fontSize: '16px', color: 'var(--text-muted)' }}>Upload a video to start collecting parking analytics.</p>
          </div>
        </div>
      ) : (
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'var(--text-primary)' }}>Analytics</h1>

          {/* Heatmap Section */}
          <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Occupancy Heatmap</h2>
              <select value={range} onChange={(e) => setRange(e.target.value)} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)' }}>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px', color: 'var(--text-primary)', border: '1px solid var(--panel-border)' }}>Hour</th>
                    {zones.map(zone => (
                      <th key={zone} style={{ padding: '8px', color: 'var(--text-primary)', border: '1px solid var(--panel-border)' }}>{zone}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hours.map(hour => (
                    <tr key={hour}>
                      <td style={{ padding: '8px', color: 'var(--text-primary)', border: '1px solid var(--panel-border)' }}>{hour}:00</td>
                      {zones.map(zone => (
                        <td
                          key={`${zone}-${hour}`}
                          style={{
                            padding: '8px',
                            backgroundColor: getColor(heatmap[zone]?.[hour] || 0),
                            border: '1px solid var(--panel-border)',
                            cursor: 'pointer',
                            color: 'white',
                            textAlign: 'center'
                          }}
                          onMouseEnter={() => setTooltip(`${zone}, ${hour}:00 — avg ${(heatmap[zone]?.[hour] || 0) * 100}%`)}
                          onMouseLeave={() => setTooltip('')}
                        >
                          {(heatmap[zone]?.[hour] || 0) * 100}%
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {tooltip && (
              <div style={{
                position: 'fixed',
                top: '10px',
                right: '10px',
                background: 'var(--panel-bg)',
                padding: '8px',
                borderRadius: '4px',
                color: 'var(--text-primary)',
                zIndex: 1000
              }}>
                {tooltip}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
              <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Busiest Zone</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{computedStats.busiestZone}</div>
              </div>
              <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Peak Hour</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{computedStats.peakHour}</div>
              </div>
              <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Quietest Period</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{computedStats.quietestPeriod}</div>
              </div>
            </div>
          </div>

          {/* Dwell Time Section */}
          <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Dwell Time Analytics</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
              <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.avg_dwell} min</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Avg Dwell</div>
              </div>
              <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.median_dwell} min</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Median</div>
              </div>
              <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.max_dwell} min</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Max</div>
              </div>
              <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.most_common} min</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Most Common</div>
              </div>
            </div>

            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Avg Dwell Time per Hour</h3>
            <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              Bar Chart Placeholder
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPage;
