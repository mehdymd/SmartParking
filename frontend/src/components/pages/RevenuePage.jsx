import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../lib/api';

const RevenuePage = () => {
  const [summary, setSummary] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [chartRange, setChartRange] = useState('7d');
  const [chartData, setChartData] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const fetchSummary = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('/revenue/summary'));
      setSummary(await r.json());
    } catch {}
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const r = await fetch(apiUrl(`/revenue/transactions?page=${currentPage}`));
      const d = await r.json();
      setTransactions(d.transactions || []);
      setTotal(d.total || 0);
      setTotalPages(Math.max(1, Math.ceil((d.total || 0) / 20)));
    } catch {}
  }, [currentPage]);

  const fetchChart = useCallback(async () => {
    try {
      const r = await fetch(apiUrl(`/revenue/chart?range=${chartRange}`));
      const d = await r.json();
      setChartData(d.data || []);
    } catch {}
  }, [chartRange]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    fetchChart();
  }, [fetchChart]);

  const formatTime = (t) => {
    if (!t) return '—';
    try {
      const d = new Date(t);
      if (isNaN(d.getTime())) return t;
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return t;
    }
  };

  const filtered = transactions.filter((t) => {
    if (filter !== 'all' && t.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return [t.plate, t.slot, t.type].some((f) => (f || '').toLowerCase().includes(s));
    }
    return true;
  });

  const maxChart = Math.max(1, ...chartData.map((d) => d.total || 0));
  const avgChart = chartData.length > 0
    ? chartData.reduce((sum, d) => sum + (d.total || 0), 0) / chartData.length
    : 0;
  const totalRevenue = chartData.reduce((sum, d) => sum + (d.total || 0), 0);
  const completedCount = transactions.filter((t) => t.status === 'completed').length;
  const activeCount = transactions.filter((t) => t.status === 'open').length;
  const pendingCount = transactions.filter((t) => t.status === 'pending').length;
  const completionRate = transactions.length > 0
    ? Math.round((completedCount / Math.max(1, transactions.length)) * 100)
    : 0;
  const peakDay = chartData.reduce((best, current) => (
    (current.total || 0) > (best.total || 0) ? current : best
  ), chartData[0] || {});

  const cards = [
    { label: 'Today', key: 'today', color: '#2ECC71', note: 'Current day intake' },
    { label: 'This Week', key: 'week', color: '#3498DB', note: 'Rolling weekly total' },
    { label: 'This Month', key: 'month', color: '#F59E0B', note: 'Month-to-date gross' },
    { label: 'Avg / Vehicle', key: 'avg_per_vehicle', color: '#EF4444', note: 'Average closed ticket' },
  ];

  const pages = [];
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i += 1) {
    pages.push(i);
  }

  const statusBadge = (status) => {
    const map = {
      completed: { color: '#2ECC71', bg: 'rgba(46,204,113,0.12)', border: 'rgba(46,204,113,0.22)', label: 'Completed' },
      open: { color: '#3498DB', bg: 'rgba(52,152,219,0.12)', border: 'rgba(52,152,219,0.22)', label: 'Active' },
      pending: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)', label: 'Pending' },
    };
    const s = map[status] || map.pending;
    return (
      <span
        className="rv-badge"
        style={{ '--badge-color': s.color, '--badge-bg': s.bg, '--badge-border': s.border }}
      >
        {s.label}
      </span>
    );
  };

  const handleExportReport = async () => {
    try {
      const response = await fetch(apiUrl('/export/download'));
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Export failed');
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename=([^;]+)/i);
      link.href = objectUrl;
      link.download = (match?.[1] || 'report.csv').replace(/"/g, '');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      alert(error.message || 'Export failed');
    }
  };

  return (
    <div className="rv-page">
      <div className="rv-header">
        <div>
          <h1 className="rv-title">Revenue</h1>
          <p className="rv-subtitle">Financial overview and transaction analytics.</p>
        </div>
        <button
          className="rv-action-btn"
          onClick={handleExportReport}
        >
          Export Report
        </button>
      </div>

      <div className="rv-stats-grid">
        {cards.map((c) => (
          <div key={c.key} className="glass rv-stat-card" style={{ '--accent-color': c.color }}>
            <div className="rv-stat-label">{c.label}</div>
            {(() => {
              const amount = summary[c.key] !== undefined ? (parseFloat(summary[c.key]) || 0).toFixed(2) : '0.00';
              const [whole, cents] = amount.split('.');
              return (
                <div className="rv-stat-value">
                  <span className="rv-stat-currency">$</span>
                  <span className="rv-stat-major">{whole}</span>
                  <span className="rv-stat-minor">.{cents}</span>
                </div>
              );
            })()}
            <div className="rv-stat-note">{c.note}</div>
          </div>
        ))}
      </div>

      <div className="rv-main-grid">
        <div className="glass rv-panel">
          <div className="rv-panel-header">
            <div>
              <h2 className="rv-panel-title">Daily Revenue</h2>
              <p className="rv-panel-meta">
                Avg ${avgChart.toFixed(2)}/day · Total ${totalRevenue.toFixed(2)} · Peak {peakDay?.date ? peakDay.date.slice(5) : '—'}
              </p>
            </div>
            <div className="rv-tabs">
              {['7d', '30d'].map((r) => (
                <button
                  key={r}
                  className={`rv-tab${chartRange === r ? ' rv-tab-active' : ''}`}
                  onClick={() => setChartRange(r)}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="rv-chart-area">
            {chartData.length > 0 ? chartData.map((d, i) => (
              <div key={i} className="rv-bar-group" title={`$${(d.total || 0).toFixed(2)}`}>
                <div className="rv-bar-track">
                  <div
                    className="rv-bar-fill"
                    style={{ height: `${Math.max(2, ((d.total || 0) / maxChart) * 100)}%` }}
                  />
                  <div className="rv-bar-avg" style={{ bottom: `${(avgChart / maxChart) * 100}%` }} />
                </div>
                <span className="rv-bar-x">{d.date ? d.date.slice(5) : ''}</span>
              </div>
            )) : (
              <div className="rv-chart-empty">No data for this period</div>
            )}
          </div>
        </div>

        <div className="glass rv-panel">
          <h2 className="rv-panel-title">Metrics</h2>
          <p className="rv-panel-meta">Current status and completion mix.</p>

          <div className="rv-metric-row">
            <span className="rv-metric-label">Total Transactions</span>
            <span className="rv-metric-value">{total}</span>
          </div>
          <div className="rv-metric-row">
            <span className="rv-metric-label">Active Sessions</span>
            <span className="rv-metric-value">{activeCount}</span>
          </div>
          <div className="rv-metric-row">
            <span className="rv-metric-label">Completion Rate</span>
            <span className="rv-metric-value">{completionRate}%</span>
          </div>

          <div className="rv-divider" />

          <div className="rv-bar-horizontal-row">
            <span className="rv-bar-h-label">Completed</span>
            <div className="rv-bar-h-track">
              <div className="rv-bar-h-fill" style={{ '--fill-w': `${total > 0 ? (completedCount / total) * 100 : 0}%`, '--fill-c': '#2ECC71' }} />
            </div>
            <span className="rv-bar-h-count">{completedCount}</span>
          </div>
          <div className="rv-bar-horizontal-row">
            <span className="rv-bar-h-label">Active</span>
            <div className="rv-bar-h-track">
              <div className="rv-bar-h-fill" style={{ '--fill-w': `${total > 0 ? (activeCount / total) * 100 : 0}%`, '--fill-c': '#3498DB' }} />
            </div>
            <span className="rv-bar-h-count">{activeCount}</span>
          </div>
          <div className="rv-bar-horizontal-row">
            <span className="rv-bar-h-label">Pending</span>
            <div className="rv-bar-h-track">
              <div className="rv-bar-h-fill" style={{ '--fill-w': `${total > 0 ? (pendingCount / total) * 100 : 0}%`, '--fill-c': '#F59E0B' }} />
            </div>
            <span className="rv-bar-h-count">{pendingCount}</span>
          </div>
        </div>
      </div>

      <div className="glass rv-panel">
        <div className="rv-panel-header">
          <div>
            <h2 className="rv-panel-title">Transactions</h2>
            <p className="rv-panel-meta">{filtered.length} visible of {total} total records</p>
          </div>
          <div className="rv-table-toolbar">
            <div className="rv-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="rv-search-input"
                placeholder="Search plate, slot..."
                aria-label="Search transactions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="rv-tabs">
              {['all', 'completed', 'open', 'pending'].map((f) => (
                <button
                  key={f}
                  className={`rv-tab${filter === f ? ' rv-tab-active' : ''}`}
                  onClick={() => {
                    setFilter(f);
                    setCurrentPage(1);
                  }}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rv-table-scroll">
          <table className="rv-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Plate</th>
                <th>Slot</th>
                <th>Type</th>
                <th>Duration</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" className="rv-table-empty">No transactions found</td>
                </tr>
              ) : filtered.map((t, i) => (
                <tr key={i}>
                  <td className="rv-cell-muted">{formatTime(t.time)}</td>
                  <td className="rv-cell-mono">{t.plate || '—'}</td>
                  <td>{t.slot || '—'}</td>
                  <td className="rv-cell-muted">{t.type || '—'}</td>
                  <td>{t.duration || '—'}</td>
                  <td className="rv-cell-amount">${t.amount || '0.00'}</td>
                  <td>{statusBadge(t.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rv-pagination">
          <span className="rv-page-info">
            {total > 0 ? `${(currentPage - 1) * 20 + 1}–${Math.min(currentPage * 20, total)} of ${total}` : '0 records'}
          </span>
          <div className="rv-page-group">
            <button className="rv-page-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
            <button className="rv-page-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            {pages.map((n) => (
              <button
                key={n}
                className={`rv-page-num${n === currentPage ? ' rv-page-active' : ''}`}
                onClick={() => setCurrentPage(n)}
              >
                {n}
              </button>
            ))}
            <button className="rv-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button className="rv-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="13 17 18 12 13 7" />
                <polyline points="6 17 11 12 6 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .rv-page {
          max-width: 1400px;
          margin: 0 auto;
          padding: 24px;
        }

        .rv-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
        }

        .rv-title {
          margin: 0 0 4px;
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .rv-subtitle {
          margin: 0;
          font-size: 14px;
          color: var(--text-muted);
        }

        .rv-action-btn {
          height: 40px;
          padding: 0 16px;
          border-radius: 8px;
          border: 1px solid var(--panel-border);
          background: rgba(255,255,255,0.04);
          color: var(--text-primary);
          font: 600 13px 'Inter', sans-serif;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease;
        }

        .rv-action-btn:hover {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.16);
        }

        .rv-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .rv-stat-card {
          padding: 16px 20px;
          position: relative;
        }

        .rv-stat-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          border-radius: 12px 12px 0 0;
          background: var(--accent-color);
        }

        .rv-stat-label {
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .rv-stat-value {
          display: flex;
          align-items: flex-start;
          gap: 2px;
          color: var(--text-primary);
          line-height: 1;
        }

        .rv-stat-currency {
          margin-top: 4px;
          font-size: 16px;
          font-weight: 700;
          color: var(--accent-color);
        }

        .rv-stat-major {
          font-size: 34px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.04em;
          font-variant-numeric: tabular-nums;
        }

        .rv-stat-minor {
          margin-top: 6px;
          font-size: 15px;
          font-weight: 600;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }

        .rv-stat-note {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .rv-main-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 16px;
          margin-bottom: 24px;
        }

        .rv-panel {
          padding: 20px;
        }

        .rv-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
        }

        .rv-panel-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .rv-panel-meta {
          margin: 4px 0 0;
          font-size: 12px;
          color: var(--text-muted);
        }

        .rv-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .rv-tab {
          height: 32px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid var(--panel-border);
          background: rgba(255,255,255,0.03);
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
        }

        .rv-tab:hover {
          color: var(--text-primary);
        }

        .rv-tab-active {
          background: rgba(52,152,219,0.18);
          border-color: rgba(52,152,219,0.4);
          color: var(--text-primary);
        }

        .rv-chart-area {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          height: 220px;
          padding-top: 8px;
        }

        .rv-bar-group {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
        }

        .rv-bar-track {
          position: relative;
          flex: 1;
          width: 100%;
          display: flex;
          align-items: flex-end;
          background: rgba(255,255,255,0.04);
          border-radius: 8px;
          margin-bottom: 8px;
          overflow: hidden;
        }

        .rv-bar-fill {
          width: 100%;
          background: linear-gradient(180deg, var(--blue), var(--blue-dark));
          border-radius: 8px 8px 0 0;
          transition: height 0.5s ease;
        }

        .rv-bar-avg {
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          border-top: 1px dashed var(--amber);
          opacity: 0.5;
        }

        .rv-bar-x {
          font-size: 10px;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
        }

        .rv-chart-empty {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          background: rgba(255,255,255,0.02);
          border-radius: 8px;
        }

        .rv-metric-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
        }

        .rv-metric-row + .rv-metric-row {
          border-top: 1px solid rgba(255,255,255,0.04);
        }

        .rv-metric-label {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .rv-metric-value {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', monospace;
        }

        .rv-divider {
          height: 1px;
          background: rgba(255,255,255,0.06);
          margin: 16px 0;
        }

        .rv-bar-horizontal-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 0;
        }

        .rv-bar-h-label {
          width: 80px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
        }

        .rv-bar-h-track {
          flex: 1;
          height: 8px;
          background: rgba(255,255,255,0.05);
          border-radius: 999px;
          overflow: hidden;
        }

        .rv-bar-h-fill {
          height: 100%;
          width: var(--fill-w, 0%);
          background: var(--fill-c);
          border-radius: 999px;
          transition: width 0.5s ease;
        }

        .rv-bar-h-count {
          width: 32px;
          text-align: right;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', monospace;
        }

        .rv-table-toolbar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 16px;
        }

        .rv-search {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          color: var(--text-muted);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .rv-search:focus-within {
          border-color: var(--blue);
          box-shadow: 0 0 0 3px rgba(52,152,219,0.15);
        }

        .rv-search-input {
          width: 180px;
          background: none;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-size: 14px;
        }

        .rv-search-input::placeholder {
          color: rgba(255,255,255,0.28);
        }

        .rv-table-scroll {
          margin: 0 -20px;
          padding: 0 20px;
          border-top: 1px solid rgba(255,255,255,0.06);
          overflow-x: auto;
        }

        .rv-table {
          width: 100%;
          border-collapse: collapse;
        }

        .rv-table th {
          position: sticky;
          top: 0;
          z-index: 1;
          padding: 14px 16px;
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(26,26,26,0.96);
        }

        .rv-table td {
          padding: 14px 16px;
          font-size: 14px;
          color: var(--text-secondary);
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }

        .rv-table tr:hover td {
          background: rgba(255,255,255,0.03);
        }

        .rv-cell-muted {
          color: var(--text-muted);
          font-size: 13px;
        }

        .rv-cell-mono {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .rv-cell-amount {
          font-weight: 700;
          color: var(--green);
          font-family: 'JetBrains Mono', monospace;
        }

        .rv-badge {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--badge-color);
          background: var(--badge-bg);
          border: 1px solid var(--badge-border);
        }

        .rv-table-empty {
          padding: 40px 16px;
          text-align: center;
          color: var(--text-muted);
        }

        .rv-pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding-top: 20px;
        }

        .rv-page-info {
          font-size: 13px;
          color: var(--text-muted);
        }

        .rv-page-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .rv-page-btn,
        .rv-page-num {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          color: var(--text-muted);
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
        }

        .rv-page-btn:hover:not(:disabled),
        .rv-page-num:hover {
          background: rgba(255,255,255,0.06);
          border-color: rgba(255,255,255,0.14);
          color: var(--text-primary);
        }

        .rv-page-active {
          background: rgba(52,152,219,0.18);
          border-color: rgba(52,152,219,0.4);
          color: var(--text-primary);
        }

        .rv-page-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        @media (max-width: 1100px) {
          .rv-stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .rv-main-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .rv-page {
            padding: 22px 16px 28px;
          }

          .rv-header {
            flex-direction: column;
            align-items: stretch;
          }

          .rv-stats-grid {
            grid-template-columns: 1fr;
          }

          .rv-table-toolbar {
            flex-direction: column;
            align-items: stretch;
          }

          .rv-search-input {
            width: 100%;
          }

          .rv-pagination {
            flex-direction: column;
            align-items: stretch;
          }

          .rv-page-group {
            justify-content: space-between;
          }
        }
      `}</style>
    </div>
  );
};

export default RevenuePage;
