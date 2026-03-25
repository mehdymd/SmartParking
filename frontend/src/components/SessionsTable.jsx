import React, { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';

const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
};

const getSessionDurationMinutes = (session, nowTs) => {
  if (typeof session.duration_minutes === 'number') {
    return session.duration_minutes;
  }

  if (!session.entry_time) {
    return null;
  }

  const entry = new Date(session.entry_time).getTime();
  if (Number.isNaN(entry)) {
    return null;
  }

  const end = session.exit_time ? new Date(session.exit_time).getTime() : nowTs;
  if (Number.isNaN(end) || end < entry) {
    return null;
  }

  return Math.max(0, Math.floor((end - entry) / 60000));
};

const SessionsTable = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch(apiUrl('/parking/sessions?limit=10'));
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
    const id = setInterval(fetchSessions, 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const activeCount = sessions.filter((session) => !session.exit_time).length;

  return (
    <div className="glass" style={{ padding: '16px 20px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Recent Sessions</h2>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {loading ? '…' : `${sessions.length} records · ${activeCount} active`}
        </span>
      </div>

      <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <th style={{ padding: '6px 4px', position: 'sticky', top: 0, background: 'var(--panel-bg)' }}>Slot</th>
              <th style={{ padding: '6px 4px', position: 'sticky', top: 0, background: 'var(--panel-bg)' }}>Entry</th>
              <th style={{ padding: '6px 4px', position: 'sticky', top: 0, background: 'var(--panel-bg)' }}>Exit</th>
              <th style={{ padding: '6px 4px', position: 'sticky', top: 0, background: 'var(--panel-bg)' }}>Status</th>
              <th style={{ padding: '6px 4px', position: 'sticky', top: 0, background: 'var(--panel-bg)', textAlign: 'right' }}>Min</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, idx) => {
              const active = !s.exit_time;
              const durationMinutes = getSessionDurationMinutes(s, nowTs);
              return (
                <tr key={`${s.slot_id}-${s.entry_time}-${idx}`} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '6px 4px', color: 'var(--text-primary)', fontWeight: 600 }}>{s.slot_id || '—'}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--text-secondary)' }}>{fmtTime(s.entry_time)}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--text-secondary)' }}>{fmtTime(s.exit_time)}</td>
                  <td style={{ padding: '6px 4px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        color: active ? '#10B981' : 'var(--text-secondary)',
                        background: active ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.06)',
                        border: active ? '1px solid rgba(16,185,129,0.28)' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {active ? 'ACTIVE' : 'CLOSED'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 4px', color: 'var(--text-secondary)', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
                    {typeof durationMinutes === 'number' ? durationMinutes : '—'}
                  </td>
                </tr>
              );
            })}
            {!loading && sessions.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '8px 4px', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No sessions yet.
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
