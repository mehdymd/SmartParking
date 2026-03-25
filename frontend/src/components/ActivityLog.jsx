import React, { useState, useEffect } from 'react';
import { Car, AlertTriangle, Gauge } from 'lucide-react';
import { apiUrl } from '../lib/api';

const ActivityLog = () => {
  const [sessions, setSessions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    fetchSessions();
    fetchAlerts();
    const id = setInterval(() => { fetchSessions(); fetchAlerts(); }, 5000);
    return () => clearInterval(id);
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await fetch(apiUrl('/parking/sessions?limit=50'));
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch {}
  };

  const fetchAlerts = async () => {
    try {
      const response = await fetch(apiUrl('/alerts?limit=20&resolved=false'));
      const data = await response.json();
      setAlerts(data.alerts || []);
    } catch {}
  };

  const sessionItems = sessions.flatMap((session, index) => {
    const items = [];

    if (session.entry_time) {
      items.push({
        type: 'event',
        eventType: 'Entered',
        id: `entry-${session.slot_id || 'slot'}-${session.entry_time}-${index}`,
        timestamp: session.entry_time,
        slot_id: session.slot_id,
      });
    }

    if (session.exit_time) {
      items.push({
        type: 'event',
        eventType: 'Exited',
        id: `exit-${session.slot_id || 'slot'}-${session.exit_time}-${index}`,
        timestamp: session.exit_time,
        slot_id: session.slot_id,
      });
    }

    return items;
  });

  const entryCount = sessionItems.filter((item) => item.eventType === 'Entered').length;
  const exitCount = sessionItems.filter((item) => item.eventType === 'Exited').length;
  const activeAlerts = alerts.filter((item) => !item.resolved);

  // Merge sessions and alerts into a unified timeline.
  const allItems = [
    ...sessionItems,
    ...activeAlerts.map(a => {
      let detail = {};
      try { detail = JSON.parse(a.detail || '{}'); } catch {}
      return {
        type: 'alert',
        id: `a-${a.id}`,
        timestamp: a.timestamp,
        alert_type: a.alert_type,
        slot_id: a.slot_id,
        vehicle_id: a.vehicle_id,
        speed_kmh: detail.speed_kmh,
        resolved: a.resolved,
      };
    }),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const filteredItems = allItems.filter(item => {
    if (filter === 'All') return true;
    if (filter === 'Entered') return item.type === 'event' && item.eventType === 'Entered';
    if (filter === 'Exited') return item.type === 'event' && item.eventType === 'Exited';
    if (filter === 'Alerts') return item.type === 'alert';
    return true;
  });

  const getZoneColor = (slotId) => {
    const zone = slotId ? slotId[0] : 'A';
    const colors = { A: 'var(--blue)', B: 'var(--green)', C: 'var(--amber)' };
    return colors[zone] || 'var(--blue)';
  };

  const filters = ['All', 'Entered', 'Exited', 'Alerts'];

  return (
    <div className="glass" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Recent Activity</h2>
        <button style={{ color: 'var(--blue)', fontSize: '12px', border: 'none', background: 'none', cursor: 'pointer' }}>View All →</button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '4px 10px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: filter === f ? (f === 'Alerts' ? '#ef4444' : 'var(--blue)') : 'transparent',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            {f === 'Entered'
              ? `Entered (${entryCount})`
              : f === 'Exited'
              ? `Exited (${exitCount})`
              : f === 'Alerts'
              ? `Alerts (${activeAlerts.length})`
              : f}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '200px' }}>
        {filteredItems.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
            <Car size={20} />
            <div style={{ fontSize: '12px', marginTop: '6px' }}>No recent activity</div>
          </div>
        ) : (
          filteredItems.map(item => {
            if (item.type === 'alert') {
              return (
                <div key={item.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '7px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  opacity: item.resolved ? 0.5 : 1,
                }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', width: '70px', flexShrink: 0 }}>
                    {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '—'}
                  </div>
                  <div style={{ marginRight: '10px' }}>
                    {item.alert_type === 'speed'
                      ? <Gauge size={14} color="#ef4444" />
                      : <AlertTriangle size={14} color="#f59e0b" />}
                  </div>
                  <div style={{ fontSize: '12px', color: '#ef4444', flex: 1, fontWeight: 500 }}>
                    {item.alert_type === 'speed' && item.speed_kmh
                      ? `Speeding — ${item.speed_kmh} km/h`
                      : item.alert_type === 'wrong_way'
                      ? 'Wrong-way detected'
                      : item.alert_type === 'abandoned'
                      ? 'Abandoned vehicle'
                      : `Alert — ${item.alert_type}`}
                    {item.slot_id && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · Slot {item.slot_id}</span>}
                  </div>
                  <div style={{
                    padding: '2px 7px',
                    borderRadius: '10px',
                    backgroundColor: item.resolved ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.15)',
                    color: item.resolved ? 'var(--text-muted)' : '#ef4444',
                    fontSize: '9px',
                    fontWeight: 600
                  }}>
                    {item.resolved ? 'OK' : 'NEW'}
                  </div>
                </div>
              );
            }

            // Regular event
            const isEntry = item.eventType === 'Entered';
            return (
              <div key={item.id} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '7px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)'
              }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', width: '70px', flexShrink: 0 }}>
                  {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '—'}
                </div>
                <div style={{ marginRight: '10px' }}>
                  <Car size={14} color={isEntry ? '#2ECC71' : '#EF4444'} />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-primary)', flex: 1 }}>
                  Slot {item.slot_id}
                  {isEntry
                    ? <span style={{ color: '#2ECC71', marginLeft: 4 }}>Entered</span>
                    : <span style={{ color: '#EF4444', marginLeft: 4 }}>Exited</span>}
                </div>
                <div style={{
                  padding: '2px 7px',
                  borderRadius: '10px',
                  backgroundColor: getZoneColor(item.slot_id),
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 600
                }}>
                  {item.slot_id ? item.slot_id[0] : 'A'}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ActivityLog;
