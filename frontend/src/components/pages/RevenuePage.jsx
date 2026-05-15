import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';
import { apiUrl } from '../../lib/api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, Legend);

const PAGE_SIZE = 20;
const STATUS_FILTERS = ['all', 'paid', 'pending', 'failed'];

const formatTime = (value) => {
  if (!value) return '-';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return value;
  }
};

const normalizeStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'paid';
  if (['failed', 'voided', 'expired'].includes(normalized)) return 'failed';
  if (normalized === 'pending') return 'pending';
  return normalized || 'pending';
};

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
      const response = await fetch(apiUrl('/revenue/summary'));
      setSummary(await response.json());
    } catch {}
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(`/revenue/transactions?page=${currentPage}`));
      const payload = await response.json();
      setTransactions(payload.transactions || []);
      setTotal(payload.total || 0);
      setTotalPages(Math.max(1, Math.ceil((payload.total || 0) / PAGE_SIZE)));
    } catch {}
  }, [currentPage]);

  const fetchChart = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(`/revenue/chart?range=${chartRange}`));
      const payload = await response.json();
      setChartData(payload.data || []);
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

  const filteredTransactions = useMemo(() => transactions.filter((transaction) => {
    const normalizedStatus = normalizeStatus(transaction.status);
    if (filter !== 'all' && normalizedStatus !== filter) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return [transaction.plate, transaction.slot, transaction.type]
      .some((field) => String(field || '').toLowerCase().includes(needle));
  }), [filter, search, transactions]);

  const avgChart = chartData.length > 0
    ? chartData.reduce((sum, item) => sum + Number(item.total || 0), 0) / chartData.length
    : 0;
  const totalRevenue = chartData.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalTransactionCount = Number(summary.total_transactions || total || 0);
  const paidCount = Number(summary.paid_transactions ?? summary.completed_transactions ?? 0);
  const pendingCount = Number(summary.pending_transactions || 0);
  const failedCount = Number(summary.failed_transactions || 0);
  const paidRate = Math.round(Number(summary.completion_rate || 0));
  const peakDay = chartData.reduce((best, current) => (
    Number(current.total || 0) > Number(best.total || 0) ? current : best
  ), chartData[0] || {});
  const lineChartData = useMemo(() => ({
    labels: chartData.map((item) => item.date ? item.date.slice(5) : ''),
    datasets: [
      {
        label: 'Revenue',
        data: chartData.map((item) => Number(item.total || 0)),
        borderColor: '#3498DB',
        backgroundColor: 'rgba(52, 152, 219, 0.14)',
        pointBackgroundColor: '#2ECC71',
        pointBorderColor: '#0b111b',
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBorderWidth: 2,
        borderWidth: 3,
        tension: 0.35,
        fill: true,
      },
      {
        label: 'Average',
        data: chartData.map(() => Number(avgChart.toFixed(2))),
        borderColor: 'rgba(255, 255, 255, 0.38)',
        borderDash: [6, 6],
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0,
        fill: false,
      },
    ],
  }), [avgChart, chartData]);
  const lineChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(11, 17, 27, 0.94)',
        borderColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        titleColor: '#F8FAFC',
        bodyColor: '#CBD5E1',
        padding: 12,
        displayColors: false,
        callbacks: {
          label: (context) => `${context.dataset.label}: $${Number(context.parsed.y || 0).toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: 'rgba(148, 163, 184, 0.85)',
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(255, 255, 255, 0.06)',
        },
        ticks: {
          color: 'rgba(148, 163, 184, 0.85)',
          callback: (value) => `$${value}`,
        },
      },
    },
  }), []);

  const summaryCards = [
    { label: 'Today', key: 'today', color: '#2ECC71', note: 'Cashier revenue today' },
    { label: 'This Week', key: 'week', color: '#3498DB', note: 'Rolling weekly total' },
    { label: 'This Month', key: 'month', color: '#F59E0B', note: 'Month-to-date revenue' },
    { label: 'Avg / Payment', key: 'avg_per_vehicle', color: '#EF4444', note: 'Average paid cashier ticket' },
  ];

  const pages = [];
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i += 1) {
    pages.push(i);
  }

  const statusBadge = (status) => {
    const map = {
      paid: { color: '#2ECC71', bg: 'rgba(46,204,113,0.12)', border: 'rgba(46,204,113,0.22)', label: 'Paid' },
      pending: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)', label: 'Pending' },
      failed: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.22)', label: 'Failed' },
    };
    const tone = map[normalizeStatus(status)] || map.pending;
    return (
      <span
        className="rv-badge"
        style={{ '--badge-color': tone.color, '--badge-bg': tone.bg, '--badge-border': tone.border }}
      >
        {tone.label}
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
          <p className="rv-subtitle">Cashier portal payments, revenue trends, and transaction history.</p>
        </div>
        <button className="rv-action-btn" onClick={handleExportReport}>
          Export Report
        </button>
      </div>

      <div className="rv-stats-grid">
        {summaryCards.map((card) => {
          const amount = summary[card.key] !== undefined ? (parseFloat(summary[card.key]) || 0).toFixed(2) : '0.00';
          const [whole, cents] = amount.split('.');
          return (
            <div key={card.key} className="glass rv-stat-card" style={{ '--accent-color': card.color }}>
              <div className="rv-stat-label">{card.label}</div>
              <div className="rv-stat-value">
                <span className="rv-stat-currency">$</span>
                <span className="rv-stat-major">{whole}</span>
                <span className="rv-stat-minor">.{cents}</span>
              </div>
              <div className="rv-stat-note">{card.note}</div>
            </div>
          );
        })}
      </div>

      <div className="rv-main-grid">
        <div className="glass rv-panel">
          <div className="rv-panel-header">
            <div>
              <h2 className="rv-panel-title">Daily Revenue</h2>
              <p className="rv-panel-meta">
                Avg ${avgChart.toFixed(2)}/day | Total ${totalRevenue.toFixed(2)} | Peak {peakDay?.date ? peakDay.date.slice(5) : '-'}
              </p>
            </div>
            <div className="rv-tabs">
              {['7d', '30d'].map((rangeKey) => (
                <button
                  key={rangeKey}
                  className={`rv-tab${chartRange === rangeKey ? ' rv-tab-active' : ''}`}
                  onClick={() => setChartRange(rangeKey)}
                >
                  {rangeKey.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="rv-chart-area">
            {chartData.length > 0 ? (
              <div className="rv-line-chart-shell">
                <Line data={lineChartData} options={lineChartOptions} />
              </div>
            ) : (
              <div className="rv-chart-empty">No cashier revenue data for this period</div>
            )}
          </div>
        </div>

        <div className="glass rv-panel">
          <h2 className="rv-panel-title">Metrics</h2>
          <p className="rv-panel-meta">Cashier payment mix and paid conversion.</p>

          <div className="rv-metric-row">
            <span className="rv-metric-label">Total Transactions</span>
            <span className="rv-metric-value">{totalTransactionCount}</span>
          </div>
          <div className="rv-metric-row">
            <span className="rv-metric-label">Paid Transactions</span>
            <span className="rv-metric-value">{paidCount}</span>
          </div>
          <div className="rv-metric-row">
            <span className="rv-metric-label">Paid Rate</span>
            <span className="rv-metric-value">{paidRate}%</span>
          </div>

          <div className="rv-divider" />

          <div className="rv-bar-horizontal-row">
            <span className="rv-bar-h-label">Paid</span>
            <div className="rv-bar-h-track">
              <div className="rv-bar-h-fill" style={{ '--fill-w': `${totalTransactionCount > 0 ? (paidCount / totalTransactionCount) * 100 : 0}%`, '--fill-c': '#2ECC71' }} />
            </div>
            <span className="rv-bar-h-count">{paidCount}</span>
          </div>
          <div className="rv-bar-horizontal-row">
            <span className="rv-bar-h-label">Pending</span>
            <div className="rv-bar-h-track">
              <div className="rv-bar-h-fill" style={{ '--fill-w': `${totalTransactionCount > 0 ? (pendingCount / totalTransactionCount) * 100 : 0}%`, '--fill-c': '#F59E0B' }} />
            </div>
            <span className="rv-bar-h-count">{pendingCount}</span>
          </div>
          <div className="rv-bar-horizontal-row">
            <span className="rv-bar-h-label">Failed / Voided</span>
            <div className="rv-bar-h-track">
              <div className="rv-bar-h-fill" style={{ '--fill-w': `${totalTransactionCount > 0 ? (failedCount / totalTransactionCount) * 100 : 0}%`, '--fill-c': '#EF4444' }} />
            </div>
            <span className="rv-bar-h-count">{failedCount}</span>
          </div>
        </div>
      </div>

      <div className="glass rv-panel">
        <div className="rv-panel-header">
          <div>
            <h2 className="rv-panel-title">Transactions</h2>
            <p className="rv-panel-meta">{filteredTransactions.length} visible of {total} total records</p>
          </div>
          <div className="rv-table-toolbar">
            <div className="rv-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="rv-search-input"
                placeholder="Search plate, slot, or method..."
                aria-label="Search transactions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="rv-tabs">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  className={`rv-tab${filter === status ? ' rv-tab-active' : ''}`}
                  onClick={() => {
                    setFilter(status);
                    setCurrentPage(1);
                  }}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
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
                <th>Method</th>
                <th>Duration</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="rv-table-empty">No cashier transactions found</td>
                </tr>
              ) : filteredTransactions.map((transaction) => (
                <tr key={`${transaction.time || 'txn'}-${transaction.plate || 'na'}-${transaction.slot || 'na'}`}>
                  <td className="rv-cell-muted">{formatTime(transaction.time)}</td>
                  <td className="rv-cell-mono">{transaction.plate || '-'}</td>
                  <td>{transaction.slot || '-'}</td>
                  <td className="rv-cell-muted">{transaction.type || '-'}</td>
                  <td>{transaction.duration || '-'}</td>
                  <td className="rv-cell-amount">${Number(transaction.amount || 0).toFixed(2)}</td>
                  <td>{statusBadge(transaction.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rv-pagination">
          <span className="rv-page-info">
            {total > 0 ? `${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, total)} of ${total}` : '0 records'}
          </span>
          <div className="rv-page-group">
            <button className="rv-page-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
            <button className="rv-page-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            {pages.map((page) => (
              <button
                key={page}
                className={`rv-page-num${page === currentPage ? ' rv-page-active' : ''}`}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}
            <button className="rv-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>
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

        .rv-header,
        .rv-panel-header,
        .rv-table-toolbar,
        .rv-pagination,
        .rv-page-group,
        .rv-metric-row,
        .rv-bar-horizontal-row {
          display: flex;
          align-items: center;
        }

        .rv-header,
        .rv-panel-header,
        .rv-pagination {
          justify-content: space-between;
          gap: 16px;
        }

        .rv-header {
          align-items: flex-start;
          margin-bottom: 24px;
        }

        .rv-title {
          margin: 0 0 4px;
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .rv-subtitle,
        .rv-panel-meta,
        .rv-stat-note,
        .rv-cell-muted,
        .rv-page-info {
          color: var(--text-muted);
        }

        .rv-subtitle,
        .rv-panel-meta {
          margin: 0;
          font-size: 14px;
        }

        .rv-action-btn,
        .rv-tab,
        .rv-page-btn,
        .rv-page-num,
        .rv-search-input {
          border-radius: 10px;
          border: 1px solid var(--panel-border);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-primary);
        }

        .rv-action-btn,
        .rv-tab,
        .rv-page-btn,
        .rv-page-num {
          height: 40px;
          padding: 0 16px;
          font: 600 13px 'Inter', sans-serif;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
        }

        .rv-action-btn:hover,
        .rv-tab:hover,
        .rv-page-btn:hover,
        .rv-page-num:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.18);
        }

        .rv-page-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .rv-tabs,
        .rv-page-group {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .rv-tab-active,
        .rv-page-active {
          background: rgba(52, 152, 219, 0.16);
          border-color: rgba(52, 152, 219, 0.4);
        }

        .rv-stats-grid,
        .rv-main-grid {
          display: grid;
          gap: 16px;
        }

        .rv-stats-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          margin-bottom: 24px;
        }

        .rv-main-grid {
          grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
          margin-bottom: 24px;
        }

        .rv-stat-card,
        .rv-panel {
          position: relative;
          overflow: hidden;
        }

        .rv-stat-card {
          padding: 18px 20px;
        }

        .rv-stat-card::before {
          content: '';
          position: absolute;
          inset: 0 0 auto 0;
          height: 3px;
          background: var(--accent-color);
        }

        .rv-stat-label {
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .rv-stat-value {
          display: flex;
          align-items: flex-start;
          gap: 2px;
          line-height: 1;
          color: var(--text-primary);
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
          letter-spacing: -0.04em;
        }

        .rv-stat-minor {
          margin-top: 6px;
          font-size: 15px;
          font-weight: 600;
        }

        .rv-panel {
          padding: 20px;
        }

        .rv-panel-title {
          margin: 0 0 6px;
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .rv-chart-area {
          margin-top: 20px;
          min-height: 280px;
        }

        .rv-line-chart-shell {
          height: 280px;
          padding: 12px 10px 6px;
          border-radius: 16px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015));
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .rv-metric-label,
        .rv-bar-h-label {
          font-size: 12px;
          color: var(--text-muted);
        }

        .rv-chart-empty,
        .rv-table-empty {
          padding: 32px 12px;
          text-align: center;
          color: var(--text-muted);
        }

        .rv-metric-row,
        .rv-bar-horizontal-row {
          justify-content: space-between;
          gap: 12px;
        }

        .rv-metric-row + .rv-metric-row {
          margin-top: 12px;
        }

        .rv-metric-value,
        .rv-bar-h-count,
        .rv-cell-amount,
        .rv-cell-mono {
          font-variant-numeric: tabular-nums;
        }

        .rv-metric-value {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .rv-divider {
          height: 1px;
          margin: 18px 0;
          background: rgba(255, 255, 255, 0.08);
        }

        .rv-bar-horizontal-row + .rv-bar-horizontal-row {
          margin-top: 12px;
        }

        .rv-bar-h-track {
          flex: 1;
          height: 10px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 999px;
          overflow: hidden;
        }

        .rv-bar-h-fill {
          width: var(--fill-w);
          height: 100%;
          background: var(--fill-c);
          border-radius: inherit;
        }

        .rv-table-toolbar {
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .rv-search {
          min-width: 240px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          border-radius: 12px;
          border: 1px solid var(--panel-border);
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-muted);
        }

        .rv-search-input {
          width: 100%;
          height: 40px;
          border: 0;
          background: transparent;
          outline: none;
          padding: 0;
        }

        .rv-table-scroll {
          margin-top: 16px;
          overflow-x: auto;
        }

        .rv-table {
          width: 100%;
          border-collapse: collapse;
        }

        .rv-table th,
        .rv-table td {
          padding: 14px 12px;
          text-align: left;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .rv-table th {
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .rv-table td {
          color: var(--text-primary);
        }

        .rv-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 80px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--badge-border);
          background: var(--badge-bg);
          color: var(--badge-color);
          font-size: 12px;
          font-weight: 700;
        }

        @media (max-width: 1100px) {
          .rv-stats-grid,
          .rv-main-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 780px) {
          .rv-page {
            padding: 16px;
          }

          .rv-stats-grid,
          .rv-main-grid {
            grid-template-columns: 1fr;
          }

          .rv-header,
          .rv-panel-header,
          .rv-pagination {
            flex-direction: column;
            align-items: stretch;
          }

          .rv-table-toolbar {
            justify-content: stretch;
          }

          .rv-search {
            min-width: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

export default RevenuePage;
