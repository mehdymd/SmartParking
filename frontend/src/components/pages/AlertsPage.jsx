import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Car, CheckCircle2, Clock3, Shuffle, Zap } from 'lucide-react';
import { apiUrl } from '../../lib/api';

const ALERT_META = {
  wrong_way: {
    label: 'Wrong Way',
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.14)',
    border: 'rgba(239,68,68,0.2)',
    Icon: AlertTriangle,
  },
  speed: {
    label: 'Speed',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.14)',
    border: 'rgba(245,158,11,0.2)',
    Icon: Zap,
  },
  abandoned: {
    label: 'Abandoned',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.14)',
    border: 'rgba(245,158,11,0.2)',
    Icon: Car,
  },
  type_mismatch: {
    label: 'Type Mismatch',
    color: '#3498DB',
    bg: 'rgba(52,152,219,0.14)',
    border: 'rgba(52,152,219,0.2)',
    Icon: Shuffle,
  },
};

const getAlertMeta = (type) => ALERT_META[type] || ALERT_META.wrong_way;

const parseDetail = (detail) => {
  if (!detail) return {};
  if (typeof detail === 'object') return detail;
  try {
    return JSON.parse(detail);
  } catch {
    return { raw: detail };
  }
};

const formatAlertType = (type) => getAlertMeta(type).label;

const AlertsPage = () => {
  const [alerts, setAlerts] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [activeTab, setActiveTab] = useState('active');
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const [activeResponse, resolvedResponse] = await Promise.all([
        fetch(apiUrl('/alerts?resolved=false')),
        fetch(apiUrl('/alerts?resolved=true')),
      ]);
      const activeData = await activeResponse.json();
      const resolvedData = await resolvedResponse.json();
      setAlerts(activeData.alerts || []);
      setResolved(resolvedData.alerts || []);
    } catch {
      setAlerts([]);
      setResolved([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    const id = setInterval(fetchAlerts, 10000);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  const resolveAlert = useCallback(async (id) => {
    try {
      await fetch(apiUrl(`/alerts/${id}/resolve`), { method: 'POST' });
      if (selectedAlert?.id === id) {
        setSelectedAlert(null);
      }
      fetchAlerts();
    } catch {}
  }, [fetchAlerts, selectedAlert]);

  const currentAlerts = activeTab === 'active' ? alerts : resolved;

  const stats = useMemo(() => {
    const unresolvedSpeed = alerts.filter((a) => a.alert_type === 'speed').length;
    const critical = alerts.filter((a) => a.alert_type === 'wrong_way' || a.alert_type === 'speed').length;
    return {
      active: alerts.length,
      resolved: resolved.length,
      critical,
      speed: unresolvedSpeed,
    };
  }, [alerts, resolved]);

  useEffect(() => {
    if (!selectedAlert) return;
    const source = activeTab === 'active' ? alerts : resolved;
    const next = source.find((alert) => alert.id === selectedAlert.id);
    if (!next) {
      setSelectedAlert(null);
      return;
    }
    setSelectedAlert(next);
  }, [activeTab, alerts, resolved, selectedAlert]);

  const timeAgo = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diff = Math.max(0, Math.floor((now - time) / 1000));
    if (diff < 60) return `${diff}s ago`;
    const min = Math.floor(diff / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour}h ago`;
    const day = Math.floor(hour / 24);
    return `${day}d ago`;
  };

  const selectedDetail = selectedAlert ? parseDetail(selectedAlert.detail) : {};

  const cards = [
    { label: 'Active Alerts', value: stats.active, note: 'Requires action', color: '#EF4444' },
    { label: 'Resolved', value: stats.resolved, note: 'Closed events', color: '#2ECC71' },
    { label: 'Critical', value: stats.critical, note: 'Speed or wrong-way', color: '#F59E0B' },
    { label: 'Speed Alerts', value: stats.speed, note: 'Open speeding events', color: '#3498DB' },
  ];

  return (
    <div className="ap-page">
      <div className="ap-header">
        <div>
          <h1 className="ap-title">Alerts</h1>
          <p className="ap-subtitle">Monitor active incidents and review resolved events.</p>
        </div>
        {loading ? <div className="ap-refresh-indicator">Refreshing…</div> : null}
      </div>

      <div className="ap-stats-grid">
        {cards.map((card) => (
          <div key={card.label} className="glass ap-stat-card" style={{ '--accent-color': card.color }}>
            <div className="ap-stat-label">{card.label}</div>
            <div className="ap-stat-value">
              <span className="ap-stat-major">{card.value}</span>
            </div>
            <div className="ap-stat-note">{card.note}</div>
          </div>
        ))}
      </div>

      <div className="ap-main-grid">
        <div className="glass ap-panel">
          <div className="ap-panel-header">
            <div>
              <h2 className="ap-panel-title">Alert Queue</h2>
              <p className="ap-panel-meta">{currentAlerts.length} records in this view</p>
            </div>
            <div className="ap-tabs">
              {[
                { id: 'active', label: `Active (${alerts.length})` },
                { id: 'resolved', label: `Resolved (${resolved.length})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  className={`ap-tab${activeTab === tab.id ? ' ap-tab-active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ap-alert-list">
            {currentAlerts.length === 0 ? (
              <div className="ap-empty">
                <CheckCircle2 size={20} />
                <span>{activeTab === 'active' ? 'No active alerts' : 'No resolved alerts'}</span>
              </div>
            ) : currentAlerts.map((alert) => {
              const meta = getAlertMeta(alert.alert_type);
              const Icon = meta.Icon;
              const isSelected = selectedAlert?.id === alert.id;
              return (
                <button
                  key={alert.id}
                  className={`ap-alert-card${isSelected ? ' ap-alert-card-selected' : ''}`}
                  style={{ '--alert-color': meta.color, '--alert-bg': meta.bg, '--alert-border': meta.border }}
                  onClick={() => setSelectedAlert(alert)}
                >
                  <div className="ap-alert-top">
                    <div className="ap-alert-icon-wrap">
                      <Icon size={16} color={meta.color} />
                    </div>
                    <div className="ap-alert-copy">
                      <div className="ap-alert-title-row">
                        <span className="ap-alert-title">{formatAlertType(alert.alert_type)}</span>
                        <span className="ap-alert-age">{timeAgo(alert.timestamp)}</span>
                      </div>
                      <div className="ap-alert-meta">
                        Slot {alert.slot_id || '—'}
                        {alert.vehicle_id ? ` · Vehicle ${alert.vehicle_id}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="ap-alert-footer">
                    <span className="ap-alert-status">
                      {activeTab === 'active' ? 'Open' : 'Resolved'}
                    </span>
                    {activeTab === 'active' ? (
                      <span
                        className="ap-resolve-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          resolveAlert(alert.id);
                        }}
                      >
                        Resolve
                      </span>
                    ) : (
                      <span className="ap-resolved-mark">Done</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="glass ap-panel">
          <div className="ap-panel-header ap-panel-header-tight">
            <div>
              <h2 className="ap-panel-title">Details</h2>
              <p className="ap-panel-meta">Selected alert context and resolution info</p>
            </div>
          </div>

          {selectedAlert ? (
            <div className="ap-detail">
              <div
                className="ap-detail-badge"
                style={{
                  '--alert-color': getAlertMeta(selectedAlert.alert_type).color,
                  '--alert-bg': getAlertMeta(selectedAlert.alert_type).bg,
                  '--alert-border': getAlertMeta(selectedAlert.alert_type).border,
                }}
              >
                {formatAlertType(selectedAlert.alert_type)}
              </div>

              <div className="ap-detail-grid">
                <div className="ap-detail-item">
                  <span className="ap-detail-label">Slot</span>
                  <span className="ap-detail-value">{selectedAlert.slot_id || '—'}</span>
                </div>
                <div className="ap-detail-item">
                  <span className="ap-detail-label">Vehicle</span>
                  <span className="ap-detail-value">{selectedAlert.vehicle_id || '—'}</span>
                </div>
                <div className="ap-detail-item">
                  <span className="ap-detail-label">Status</span>
                  <span className="ap-detail-value">{activeTab === 'active' ? 'Open' : 'Resolved'}</span>
                </div>
                <div className="ap-detail-item">
                  <span className="ap-detail-label">Time</span>
                  <span className="ap-detail-value">{new Date(selectedAlert.timestamp).toLocaleString()}</span>
                </div>
              </div>

              <div className="ap-detail-section">
                <div className="ap-detail-section-title">Detail</div>
                <div className="ap-detail-body">
                  {selectedDetail.raw || selectedAlert.detail || 'No additional detail provided.'}
                </div>
              </div>

              {Object.keys(selectedDetail).length > 0 && !selectedDetail.raw && (
                <div className="ap-detail-section">
                  <div className="ap-detail-section-title">Parsed Data</div>
                  <div className="ap-kv-list">
                    {Object.entries(selectedDetail).map(([key, value]) => (
                      <div key={key} className="ap-kv-row">
                        <span className="ap-kv-key">{key}</span>
                        <span className="ap-kv-value">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'active' && (
                <button className="btn btn-green ap-resolve-btn" onClick={() => resolveAlert(selectedAlert.id)}>
                  Resolve Alert
                </button>
              )}
            </div>
          ) : (
            <div className="ap-empty ap-empty-detail">
              <Clock3 size={20} />
              <span>Select an alert to view details</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .ap-page {
          max-width: 1400px;
          margin: 0 auto;
          padding: 24px;
        }

        .ap-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
        }

        .ap-title {
          margin: 0 0 4px;
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .ap-subtitle {
          margin: 0;
          font-size: 14px;
          color: var(--text-muted);
        }

        .ap-refresh-indicator {
          min-height: 40px;
          padding: 0 14px;
          display: inline-flex;
          align-items: center;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
        }

        .ap-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .ap-stat-card {
          position: relative;
          padding: 16px 20px;
        }

        .ap-stat-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          border-radius: 12px 12px 0 0;
          background: var(--accent-color);
        }

        .ap-stat-label {
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .ap-stat-value {
          display: flex;
          align-items: flex-start;
          gap: 2px;
          color: var(--text-primary);
          line-height: 1;
        }

        .ap-stat-major {
          font-size: 34px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.04em;
          font-variant-numeric: tabular-nums;
        }

        .ap-stat-note {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .ap-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr);
          gap: 16px;
        }

        .ap-panel {
          padding: 20px;
        }

        .ap-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
        }

        .ap-panel-header-tight {
          margin-bottom: 16px;
        }

        .ap-panel-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .ap-panel-meta {
          margin: 4px 0 0;
          font-size: 12px;
          color: var(--text-muted);
        }

        .ap-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ap-tab {
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

        .ap-tab:hover {
          color: var(--text-primary);
        }

        .ap-tab-active {
          background: rgba(52,152,219,0.18);
          border-color: rgba(52,152,219,0.4);
          color: var(--text-primary);
        }

        .ap-alert-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 640px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .ap-alert-card {
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          text-align: left;
          cursor: pointer;
          transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
        }

        .ap-alert-card:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.14);
        }

        .ap-alert-card-selected {
          background: var(--alert-bg);
          border-color: var(--alert-border);
        }

        .ap-alert-top {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .ap-alert-icon-wrap {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: var(--alert-bg);
          border: 1px solid var(--alert-border);
          flex-shrink: 0;
        }

        .ap-alert-copy {
          flex: 1;
          min-width: 0;
        }

        .ap-alert-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .ap-alert-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .ap-alert-age {
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .ap-alert-meta {
          margin-top: 4px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .ap-alert-footer {
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .ap-alert-status,
        .ap-resolved-mark,
        .ap-resolve-link {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .ap-alert-status {
          background: rgba(255,255,255,0.06);
          color: var(--text-muted);
        }

        .ap-resolve-link {
          background: rgba(46,204,113,0.12);
          color: var(--green);
        }

        .ap-resolved-mark {
          background: rgba(46,204,113,0.12);
          color: var(--green);
        }

        .ap-detail {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .ap-detail-badge {
          width: fit-content;
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 12px;
          border-radius: 999px;
          background: var(--alert-bg);
          border: 1px solid var(--alert-border);
          color: var(--alert-color);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .ap-detail-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .ap-detail-item {
          padding: 12px;
          border-radius: 10px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .ap-detail-label {
          display: block;
          margin-bottom: 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .ap-detail-value {
          font-size: 13px;
          color: var(--text-primary);
          word-break: break-word;
        }

        .ap-detail-section {
          padding-top: 2px;
        }

        .ap-detail-section-title {
          margin-bottom: 8px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .ap-detail-body {
          padding: 12px;
          border-radius: 10px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.5;
          word-break: break-word;
        }

        .ap-kv-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .ap-kv-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .ap-kv-key {
          font-size: 12px;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
        }

        .ap-kv-value {
          font-size: 12px;
          color: var(--text-primary);
          text-align: right;
          word-break: break-word;
        }

        .ap-resolve-btn {
          margin-top: 4px;
        }

        .ap-empty {
          min-height: 180px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-muted);
          font-size: 13px;
          background: rgba(255,255,255,0.02);
          border-radius: 10px;
          border: 1px dashed rgba(255,255,255,0.08);
        }

        .ap-empty-detail {
          min-height: 420px;
        }

        @media (max-width: 1100px) {
          .ap-stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .ap-main-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .ap-page {
            padding: 22px 16px 28px;
          }

          .ap-header,
          .ap-panel-header {
            flex-direction: column;
            align-items: stretch;
          }

          .ap-stats-grid,
          .ap-detail-grid {
            grid-template-columns: 1fr;
          }

          .ap-alert-title-row,
          .ap-alert-footer,
          .ap-kv-row {
            flex-direction: column;
            align-items: flex-start;
          }

          .ap-kv-value {
            text-align: left;
          }
        }
      `}</style>
    </div>
  );
};

export default AlertsPage;
