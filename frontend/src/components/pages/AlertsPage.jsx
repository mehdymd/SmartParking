import React, { useState, useEffect } from 'react';
import { AlertTriangle, Zap, Car, Shuffle } from 'lucide-react';

const AlertsPage = () => {
  const [alerts, setAlerts] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [activeTab, setActiveTab] = useState('active');
  const [selectedAlert, setSelectedAlert] = useState(null);

  useEffect(() => {
    fetchAlerts();
    requestNotificationPermission();
  }, []);

  const fetchAlerts = async () => {
    const activeResponse = await fetch('http://localhost:8000/alerts?resolved=false');
    const activeData = await activeResponse.json();
    setAlerts(activeData.alerts || []);

    const resolvedResponse = await fetch('http://localhost:8000/alerts?resolved=true');
    const resolvedData = await resolvedResponse.json();
    setResolved(resolvedData.alerts || []);
  };

  const requestNotificationPermission = () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const resolveAlert = async (id) => {
    await fetch(`http://localhost:8000/alerts/${id}/resolve`, { method: 'POST' });
    fetchAlerts();
  };

  const getIcon = (type) => {
    switch (type) {
      case 'wrong_way': return <AlertTriangle size={20} color="var(--red)" />;
      case 'speed': return <Zap size={20} color="var(--amber)" />;
      case 'abandoned': return <Car size={20} color="var(--amber)" />;
      case 'type_mismatch': return <Shuffle size={20} color="var(--blue)" />;
      default: return <AlertTriangle size={20} color="var(--red)" />;
    }
  };

  const getColor = (type) => {
    switch (type) {
      case 'wrong_way': return 'var(--red)';
      case 'speed': return 'var(--amber)';
      case 'abandoned': return 'var(--amber)';
      case 'type_mismatch': return 'var(--blue)';
      default: return 'var(--red)';
    }
  };

  const timeAgo = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diff = Math.floor((now - time) / 1000);
    if (diff < 60) return `${diff}s ago`;
    const min = Math.floor(diff / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.floor(min / 60);
    return `${hour}h ago`;
  };

  const currentAlerts = activeTab === 'active' ? alerts : resolved;

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
      <div>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <button
            onClick={() => setActiveTab('active')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeTab === 'active' ? 'var(--blue)' : 'transparent',
              color: activeTab === 'active' ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer'
            }}
          >
            Active Alerts
          </button>
          <button
            onClick={() => setActiveTab('resolved')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeTab === 'resolved' ? 'var(--blue)' : 'transparent',
              color: activeTab === 'resolved' ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer'
            }}
          >
            Resolved
          </button>
        </div>

        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          {currentAlerts.map(alert => (
            <div
              key={alert.id}
              className="glass"
              style={{
                padding: '16px',
                marginBottom: '12px',
                cursor: 'pointer',
                borderLeft: activeTab === 'active' ? `4px solid ${getColor(alert.alert_type)}` : 'none',
                animation: activeTab === 'active' ? 'slideDown 0.5s ease' : 'none'
              }}
              onClick={() => setSelectedAlert(alert)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {getIcon(alert.alert_type)}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {alert.alert_type.replace('_', ' ').toUpperCase()}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Slot {alert.slot_id} • {timeAgo(alert.timestamp)}
                  </div>
                </div>
                {activeTab === 'active' && (
                  <button
                    className="btn btn-green"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                    onClick={(e) => { e.stopPropagation(); resolveAlert(alert.id); }}
                  >
                    Resolve
                  </button>
                )}
                {activeTab === 'resolved' && <div style={{ color: 'var(--green)' }}>✓</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass" style={{ padding: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>
          Resolution Panel
        </h2>
        {selectedAlert ? (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>
              {selectedAlert.alert_type.replace('_', ' ').toUpperCase()}
            </h3>
            <p style={{ color: 'var(--text-primary)' }}>Slot: {selectedAlert.slot_id}</p>
            <p style={{ color: 'var(--text-primary)' }}>Vehicle: {selectedAlert.vehicle_id}</p>
            <p style={{ color: 'var(--text-primary)' }}>Time: {new Date(selectedAlert.timestamp).toLocaleString()}</p>
            <p style={{ color: 'var(--text-primary)' }}>Detail: {selectedAlert.detail}</p>
            {activeTab === 'active' && (
              <button
                className="btn btn-green"
                style={{ marginTop: '16px' }}
                onClick={() => resolveAlert(selectedAlert.id)}
              >
                Resolve Alert
              </button>
            )}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Select an alert to view details</p>
        )}
      </div>

      <style>
        {`
          @keyframes slideDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
};

export default AlertsPage;
