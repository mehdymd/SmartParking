import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../lib/api';

const IncidentsPage = ({ token, user }) => {
  const [incidents, setIncidents] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadIncidents = async () => {
    try {
      const response = await fetch(apiUrl('/incidents'), {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const payload = await response.json();
      setIncidents(payload.incidents || []);
    } catch (err) {
      setError(err.message || 'Failed to load incidents');
    }
  };

  useEffect(() => {
    loadIncidents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateIncidentStatus = async (id, newStatus) => {
    setError('');
    setMessage('');
    try {
      const response = await fetch(apiUrl(`/incidents/${id}/status`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to update incident');
      setMessage(`Updated incident status to ${newStatus}`);
      loadIncidents();
    } catch (err) {
      setError(err.message || 'Failed to update incident');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Incidents</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>View and manage user-reported incidents. Use the dropdown to update status.</p>
      {(message || error) && <div className="glass" style={{ padding: '14px 16px', marginBottom: '20px', color: error ? '#ffb4aa' : '#b8ffd9' }}>{error || message}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: '20px' }}>
        <div className="glass" style={{ padding: '20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Image</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((item) => (
                <tr key={item.id}>
                  <td style={tdStyle}>{item.title}</td>
                  <td style={tdStyle}>{item.category}</td>
                  <td style={tdStyle}>{item.severity}</td>
                  <td style={tdStyle}>
                    <select
                      value={item.status}
                      onChange={(e) => updateIncidentStatus(item.id, e.target.value)}
                      style={{ ...tdStyle, padding: '4px 8px', background: 'transparent', border: '1px solid var(--panel-border)', borderRadius: '4px' }}
                    >
                      <option value="open">Open</option>
                      <option value="investigating">Investigating</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    {item.image_path ? (
                      <a href={apiUrl(item.image_path)} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'none' }}>View Photo</a>
                    ) : '—'}
                  </td>
                  <td style={tdStyle}>{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const thStyle = {
  textAlign: 'left',
  padding: '12px 10px',
  borderBottom: '1px solid var(--panel-border)',
  color: 'var(--text-muted)',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const tdStyle = {
  padding: '12px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
  fontSize: '13px',
};

export default IncidentsPage;