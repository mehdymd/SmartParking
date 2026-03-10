import React, { useState, useEffect } from 'react';

const LPRPage = () => {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchLogs();
  }, [search]);

  const fetchLogs = async () => {
    const url = search ? `http://localhost:8000/lpr/history?plate=${search}` : 'http://localhost:8000/lpr/history';
    const response = await fetch(url);
    const data = await response.json();
    setLogs(data.logs || []);
  };

  const computeStats = () => {
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter(log => log.timestamp.startsWith(today));
    const totalPlates = todayLogs.length;
    const uniqueVehicles = new Set(todayLogs.map(log => log.plate)).size;
    const unmatchedExits = todayLogs.filter(log => log.event_type === 'exit').length; // placeholder
    return { totalPlates, uniqueVehicles, unmatchedExits };
  };

  const stats = computeStats();

  const getConfidenceColor = (conf) => {
    if (conf >= 0.8) return 'var(--green)';
    if (conf >= 0.5) return 'var(--amber)';
    return 'var(--red)';
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'var(--text-primary)' }}>LPR</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>{stats.totalPlates}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Total Plates Today</div>
        </div>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>{stats.uniqueVehicles}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Unique Vehicles</div>
        </div>
        <div className="glass" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>{stats.unmatchedExits}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Unmatched Exits</div>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search plate…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="glass"
        style={{ padding: '12px', width: '100%', border: 'none', outline: 'none', marginBottom: '24px' }}
      />

      <table style={{ width: '100%' }} className="glass">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Timestamp</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Plate</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Slot</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Event</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Vehicle Type</th>
            <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)' }}>Confidence %</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr
              key={log.id}
              style={{ borderBottom: '1px solid var(--panel-border)', cursor: 'pointer' }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.target.style.background = 'transparent'}
              onClick={() => setSelectedLog(log)}
            >
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{new Date(log.timestamp).toLocaleString()}</td>
              <td style={{ padding: '12px', fontFamily: 'JetBrains Mono', fontWeight: 'bold', color: 'var(--text-primary)' }}>{log.plate}</td>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{log.slot_id}</td>
              <td style={{ padding: '12px' }}>
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: log.event_type === 'entry' ? 'var(--green)' : 'var(--red)',
                  color: '#fff',
                  fontSize: '12px'
                }}>
                  {log.event_type}
                </span>
              </td>
              <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{log.vehicle_type}</td>
              <td style={{ padding: '12px', color: getConfidenceColor(log.confidence) }}>
                {log.confidence ? (log.confidence * 100).toFixed(0) + '%' : 'N/A'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedLog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setSelectedLog(null)}
        >
          <div className="glass" style={{ padding: '24px', maxWidth: '400px', borderRadius: '12px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Plate Details</h2>
            <p style={{ color: 'var(--text-primary)' }}>Plate: {selectedLog.plate}</p>
            <p style={{ color: 'var(--text-primary)' }}>Confidence: {selectedLog.confidence}</p>
            <p style={{ color: 'var(--text-primary)' }}>Image: Not available</p>
            <button className="btn btn-blue" style={{ marginTop: '16px' }} onClick={() => setSelectedLog(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LPRPage;
