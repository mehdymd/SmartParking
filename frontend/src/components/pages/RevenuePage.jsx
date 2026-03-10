import React, { useState, useEffect } from 'react';

const RevenuePage = () => {
  const [summary, setSummary] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [chartRange, setChartRange] = useState('7d');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchSummary();
    fetchTransactions();
  }, [currentPage]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchChart();
  }, [chartRange]);

  const fetchSummary = async () => {
    const response = await fetch('http://localhost:8000/revenue/summary');
    // eslint-disable-next-line no-unused-vars
    const data = await response.json();
    setSummary(data);
  };

  const fetchTransactions = async () => {
    const response = await fetch(`http://localhost:8000/revenue/transactions?page=${currentPage}`);
    const data = await response.json();
    setTransactions(data.transactions || []);
    setTotalPages(Math.ceil(data.total / 20));
  };

  const fetchChart = async () => {
    const response = await fetch(`http://localhost:8000/revenue/chart?range=${chartRange}`);
    const data = await response.json();
    // Handle chart data
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'var(--text-primary)' }}>Revenue</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="glass" style={{ padding: '20px', textAlign: 'center', background: 'linear-gradient(135deg, var(--green), var(--green-dark))' }}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: '#fff' }}>${summary.today}</div>
          <div style={{ fontSize: '14px', color: '#fff' }}>Today</div>
        </div>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>${summary.week}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>This Week</div>
        </div>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>${summary.month}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>This Month</div>
        </div>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>${summary.avg_per_vehicle}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Avg Per Vehicle</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        <div className="glass" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Daily Revenue</h2>
            <select value={chartRange} onChange={(e) => setChartRange(e.target.value)} style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)' }}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
            Line Chart Placeholder
          </div>
        </div>
        <div className="glass" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Revenue by Type</h2>
          <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
            Doughnut Chart Placeholder
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Transactions</h2>
      <table style={{ width: '100%' }} className="glass">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Time</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Plate</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Slot</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Type</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Duration</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Amount</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(t => (
            <tr key={t.time} style={{ borderBottom: '1px solid var(--panel-border)' }}>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{new Date(t.time).toLocaleString()}</td>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{t.plate}</td>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{t.slot}</td>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{t.type}</td>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{t.duration}</td>
              <td style={{ padding: '12px', fontWeight: 'bold', color: 'var(--green)' }}>${t.amount}</td>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{t.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
        <button className="btn btn-ghost" onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
          Previous
        </button>
        <span style={{ color: 'var(--text-primary)' }}>Page {currentPage} of {totalPages}</span>
        <button className="btn btn-ghost" onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
          Next
        </button>
      </div>
    </div>
  );
};

export default RevenuePage;
