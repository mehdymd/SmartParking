import React, { useEffect, useState } from 'react';

const SessionsTable = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSessions = async () => {
      setLoading(true);
      try {
        const res = await fetch('http://localhost:8000/parking/sessions?limit=50');
        if (!res.ok) throw new Error('Failed to load sessions');
        const json = await res.json();
        setSessions(Array.isArray(json.sessions) ? json.sessions : []);
      } catch (e) {
        setSessions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
    const id = setInterval(fetchSessions, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="glass" style={{ padding: '20px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Recent Sessions</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {loading ? 'Loading…' : `${sessions.length} records`}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '8px 6px' }}>Slot</th>
              <th style={{ padding: '8px 6px' }}>Entry</th>
              <th style={{ padding: '8px 6px' }}>Exit</th>
              <th style={{ padding: '8px 6px' }}>Duration (min)</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, idx) => (
              <tr key={`${s.slot_id}-${s.entry_time}-${idx}`} style={{ borderTop: '1px solid var(--panel-border)' }}>
                <td style={{ padding: '8px 6px', color: 'var(--text-primary)', fontWeight: 600 }}>{s.slot_id}</td>
                <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>
                  {s.entry_time ? new Date(s.entry_time).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>
                  {s.exit_time ? new Date(s.exit_time).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>
                  {typeof s.duration_minutes === 'number' ? s.duration_minutes : '—'}
                </td>
              </tr>
            ))}
            {!loading && sessions.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '10px 6px', color: 'var(--text-muted)' }}>
                  No sessions yet (sessions appear when slots change occupied ↔ available).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SessionsTable;

