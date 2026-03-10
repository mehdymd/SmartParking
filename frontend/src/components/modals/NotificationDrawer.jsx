import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';

const NotificationDrawer = ({ isOpen, onClose }) => {
  const [notifications, setNotifications] = useState([]);
  const [filter, setFilter] = useState('All');
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  const fetchNotifications = async () => {
    // Placeholder: fetch from /alerts or something
    const data = []; // Placeholder
    setNotifications(data);
  };

  const playSound = () => {
    if (!soundEnabled) return;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  };

  const markAllRead = () => {
    setNotifications([]);
  };

  const filteredNotifications = notifications.filter(n => filter === 'All' || n.type === filter);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: isOpen ? 0 : '-320px',
      width: '320px',
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      transition: 'right 0.3s ease',
      zIndex: 2000,
      boxShadow: '-2px 0 10px rgba(0,0,0,0.3)'
    }}>
      <div className="glass" style={{ height: '100%', padding: '20px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Notifications</h2>
          <a href="#" style={{ color: 'var(--blue)', fontSize: '12px' }} onClick={markAllRead}>Mark all read</a>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {['All', 'Wrong-Way', 'Speed', 'Abandoned', 'Type Mismatch'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '4px 8px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: filter === f ? 'var(--blue)' : 'var(--bg-secondary)',
                color: filter === f ? '#fff' : 'var(--text-muted)',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredNotifications.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>
              <Bell size={24} />
              <div style={{ fontSize: '14px', marginTop: '8px' }}>All caught up!</div>
            </div>
          ) : (
            filteredNotifications.map(n => (
              <div
                key={n.id}
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  borderLeft: n.unread ? '3px solid var(--blue)' : 'none'
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>{n.title}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{n.time}</div>
              </div>
            ))
          )}
        </div>

        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          style={{
            marginTop: '16px',
            padding: '8px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: soundEnabled ? 'var(--green)' : 'var(--red)',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Sound: {soundEnabled ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
};

export default NotificationDrawer;
