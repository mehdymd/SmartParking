import React, { useState, useEffect } from 'react';
import { Car, AlertTriangle } from 'lucide-react';

const ActivityLog = () => {
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch('http://localhost:8000/parking/history?limit=50');
      const data = await response.json();
      setHistory(data.history || []);
    } catch (error) {
      console.error('Failed to fetch history', error);
    }
  };

  const filteredHistory = history.filter(item => {
    if (filter === 'All') return true;
    if (filter === 'Entered') return item.status === 'occupied';
    if (filter === 'Exited') return item.status === 'available';
    if (filter === '⚠ Alerts') return false; // Placeholder
    return true;
  });

  const getIcon = (status) => {
    if (status === 'occupied') return <Car size={16} color="var(--green)" />;
    if (status === 'available') return <Car size={16} color="var(--red)" />;
    return <AlertTriangle size={16} color="var(--amber)" />;
  };

  const getZoneColor = (slotId) => {
    const zone = slotId ? slotId[0] : 'A';
    const colors = { A: 'var(--blue)', B: 'var(--green)', C: 'var(--amber)' };
    return colors[zone] || 'var(--blue)';
  };

  const filters = ['All', 'Entered', 'Exited', '⚠ Alerts'];

  return (
    <div className="glass" style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Recent Activity</h2>
        <button style={{ color: 'var(--blue)', fontSize: '14px', border: 'none', background: 'none', cursor: 'pointer' }}>View All →</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 12px',
              borderRadius: '16px',
              border: 'none',
              backgroundColor: filter === f ? 'var(--blue)' : 'transparent',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '280px' }}>
        {filteredHistory.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>
            <Car size={24} />
            <div style={{ fontSize: '14px', marginTop: '8px' }}>No recent activity</div>
          </div>
        ) : (
          filteredHistory.map(item => (
            <div key={item.id} style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid rgba(255,255,255,0.05)'
            }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', width: '80px', flexShrink: 0 }}>
                {new Date(item.timestamp).toLocaleTimeString()}
              </div>
              <div style={{ marginRight: '12px' }}>
                {getIcon(item.status)}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', flex: 1 }}>
                Slot {item.slot_id} — {item.status === 'occupied' ? 'Car Entered' : 'Car Exited'}
              </div>
              <div style={{
                padding: '4px 8px',
                borderRadius: '12px',
                backgroundColor: getZoneColor(item.slot_id),
                color: '#fff',
                fontSize: '10px'
              }}>
                {item.slot_id ? item.slot_id[0] : 'A'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActivityLog;
