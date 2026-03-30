import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Bar } from 'react-chartjs-2';
import { apiUrl } from '../../lib/api';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const AnalyticsPage = () => {
  const [heatmap, setHeatmap] = useState({});
  const [range, setRange] = useState('30d');
  const [dwellSummary, setDwellSummary] = useState({});
  const [dwellChart, setDwellChart] = useState([]);
  const [tooltip, setTooltip] = useState('');
  const [stats, setStats] = useState({});
  const [configuredSlots, setConfiguredSlots] = useState(0);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/parking/stats'));
      const data = await response.json();
      setStats(data || {});
    } catch {
      setStats({});
    }
  }, []);

  const fetchConfiguredSlots = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/parking/slots'));
      const data = await response.json();
      setConfiguredSlots(Array.isArray(data?.polygons) ? data.polygons.length : 0);
    } catch {
      setConfiguredSlots(0);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchConfiguredSlots();
    const interval = setInterval(() => {
      fetchStats();
      fetchConfiguredSlots();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchConfiguredSlots, fetchStats]);

  const fetchHeatmap = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(`/analytics/heatmap?range=${range}`));
      const data = await response.json();
      setHeatmap(data.matrix || {});
    } catch {
      setHeatmap({});
    }
  }, [range]);

  const fetchDwellSummary = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/analytics/dwell'));
      const data = await response.json();
      setDwellSummary(data || {});
    } catch {
      setDwellSummary({});
    }
  }, []);

  const fetchForecast = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/analytics/forecast?hours=6'));
      const data = await response.json();
      setForecast(data.data || []);
    } catch {
      setForecast([]);
    }
  }, []);

  const fetchDwellChart = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(apiUrl(`/analytics/dwell/chart?range=${range}`));
      const data = await response.json();
      setDwellChart(data.data || []);
    } catch {
      setDwellChart([]);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchHeatmap();
    fetchDwellSummary();
    fetchDwellChart();
    fetchForecast();
  }, [fetchDwellChart, fetchDwellSummary, fetchForecast, fetchHeatmap]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchHeatmap();
      fetchDwellSummary();
      fetchDwellChart();
      fetchForecast();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchDwellChart, fetchDwellSummary, fetchForecast, fetchHeatmap]);

  const getColor = (value) => {
    if (value < 0.25) return '#1a3a1a';
    if (value < 0.5) return '#2ECC71';
    if (value < 0.75) return '#F59E0B';
    return '#EF4444';
  };

  const zoneLabels = { A: 'Zone A – Standard', B: 'Zone B – Economy', C: 'Zone C – Premium' };
  const zones = ['A', 'B', 'C'];

  const computeStats = () => {
    if (!heatmap || !Object.keys(heatmap).length) return { busiestZone: '', peakHour: '', quietestPeriod: '' };
    const available = Object.keys(heatmap);
    const busiestZone = available.reduce((a, b) => (sum(heatmap[a]) / 24 > sum(heatmap[b]) / 24 ? a : b));
    const avgPerHour = HOURS.map(h => sum(available.map(z => heatmap[z]?.[h] || 0)) / available.length);
    const peakHour = HOURS[avgPerHour.indexOf(Math.max(...avgPerHour))];
    const quietestPeriod = HOURS[avgPerHour.indexOf(Math.min(...avgPerHour))];
    return {
      busiestZone: `${zoneLabels[busiestZone] || busiestZone} — avg ${(sum(heatmap[busiestZone]) / 24 * 100).toFixed(0)}%`,
      peakHour: `${peakHour}:00 — avg ${(avgPerHour[peakHour] * 100).toFixed(0)}%`,
      quietestPeriod: `${quietestPeriod}:00 — avg ${(avgPerHour[quietestPeriod] * 100).toFixed(0)}%`
    };
  };

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  const computedStats = computeStats();
  const hasHeatmapData = Object.values(heatmap).some((values) => Array.isArray(values) && values.some((value) => Number(value) > 0));
  const hasDwellData = Boolean(
    dwellChart.length ||
    Number(dwellSummary.avg_dwell) ||
    Number(dwellSummary.median_dwell) ||
    Number(dwellSummary.max_dwell) ||
    Number(dwellSummary.most_common)
  );

  // Dwell chart data
  const dwellChartData = useMemo(() => {
    const lookup = {};
    dwellChart.forEach(d => { lookup[d.hour] = d.avg_dwell; });
    const labels = HOURS.map(h => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
    return {
      labels,
      datasets: [{
        data: HOURS.map(h => lookup[h] ? Math.round(lookup[h] * 10) / 10 : 0),
        backgroundColor: 'rgba(52,152,219,0.6)',
        borderRadius: 3,
        borderSkipped: false,
      }],
    };
  }, [dwellChart]);

  const dwellChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw} min` } } },
    scales: {
      y: { ticks: { callback: v => `${v}m`, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
      x: { ticks: { maxTicksLimit: 12, font: { size: 10 } }, grid: { display: false } },
    },
  }), []);

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'var(--text-primary)' }}>Analytics</h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
          <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{configuredSlots}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Configured Slots</div>
          </div>
          <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{stats.occupied ?? 0}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Occupied Now</div>
          </div>
          <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{stats.available ?? 0}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Available Now</div>
          </div>
          <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{Math.round(Number(stats.occupancy_rate || 0))}%</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Current Occupancy</div>
          </div>
        </div>

        {!loading && !hasHeatmapData && !hasDwellData && (
          <div className="glass" style={{ padding: '18px 20px', marginBottom: '24px', color: 'var(--text-secondary)' }}>
            Analytics will appear after the system records occupancy history and closed parking sessions.
          </div>
        )}

        <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Occupancy Forecast</h2>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Heuristic projection from historical occupancy by hour</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px' }}>
            {(forecast.length ? forecast : Array.from({ length: 6 }, (_, i) => ({ time: null, occupancy: 0, confidence: 0, key: i }))).map((point, idx) => (
              <div key={point.time || point.key || idx} className="glass" style={{ padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  {point.time ? new Date(point.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                </div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{Math.round(Number(point.occupancy || 0))}%</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>confidence {Math.round(Number(point.confidence || 0) * 100)}%</div>
              </div>
            ))}
          </div>
        </div>

          {/* Heatmap Section */}
          <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Occupancy Heatmap</h2>
              <select value={range} onChange={(e) => setRange(e.target.value)} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '6px' }}>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </div>

            <div style={{ overflowX: 'auto' }}>
              {hasHeatmapData ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', fontSize: '12px' }}>Hour</th>
                      {zones.map(zone => (
                        <th key={zone} style={{ padding: '6px', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', fontSize: '12px' }}>{zoneLabels[zone]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {HOURS.map(hour => (
                      <tr key={hour}>
                        <td style={{ padding: '6px', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', fontSize: '12px' }}>{hour}:00</td>
                        {zones.map(zone => (
                          <td
                            key={`${zone}-${hour}`}
                            style={{
                              padding: '6px',
                              backgroundColor: getColor(heatmap[zone]?.[hour] || 0),
                              border: '1px solid var(--panel-border)',
                              cursor: 'pointer',
                              color: 'white',
                              textAlign: 'center',
                              fontSize: '11px'
                            }}
                            onMouseEnter={() => setTooltip(`${zoneLabels[zone]}, ${hour}:00 — avg ${((heatmap[zone]?.[hour] || 0) * 100).toFixed(0)}%`)}
                            onMouseLeave={() => setTooltip('')}
                          >
                            {((heatmap[zone]?.[hour] || 0) * 100).toFixed(0)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No occupancy heatmap data recorded yet.
                </div>
              )}
            </div>

            {tooltip && (
              <div style={{ position: 'fixed', top: '10px', right: '10px', background: 'var(--panel-bg)', padding: '8px', borderRadius: '4px', color: 'var(--text-primary)', zIndex: 1000 }}>
                {tooltip}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
              <div className="glass" style={{ padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>Busiest Zone</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 4 }}>{computedStats.busiestZone || '—'}</div>
              </div>
              <div className="glass" style={{ padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>Peak Hour</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 4 }}>{computedStats.peakHour || '—'}</div>
              </div>
              <div className="glass" style={{ padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>Quietest Period</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 4 }}>{computedStats.quietestPeriod || '—'}</div>
              </div>
            </div>
          </div>

          {/* Dwell Time Section */}
          <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Dwell Time Analytics</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.avg_dwell || 0} min</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Avg Dwell</div>
              </div>
              <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.median_dwell || 0} min</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Median</div>
              </div>
              <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.max_dwell || 0} min</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Max</div>
              </div>
              <div className="glass" style={{ padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>{dwellSummary.most_common || 0} min</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Most Common</div>
              </div>
            </div>

            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-primary)' }}>Avg Dwell Time per Hour</h3>
            <div style={{ height: '200px' }}>
              {hasDwellData ? (
                <Bar data={dwellChartData} options={dwellChartOptions} />
              ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No closed-session dwell data recorded yet.
                </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
};

export default AnalyticsPage;
