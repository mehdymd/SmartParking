import React, { useState } from 'react';
import { apiUrl } from '../../lib/api';

const ManualOverrideModal = ({ isOpen, onClose }) => {
  const [slotId, setSlotId] = useState('');
  const [status, setStatus] = useState('available');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(30);

  const handleSubmit = async () => {
    const data = { slot_id: slotId, status, reason, duration };
    await fetch(apiUrl('/parking/override'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div style={{
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
    }}>
      <div className="glass" style={{ width: '480px', padding: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Manual Override</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <select
            value={slotId}
            onChange={(e) => setSlotId(e.target.value)}
            className="glass"
            style={{ padding: '12px', border: 'none', outline: 'none' }}
          >
            <option value="">Select Slot</option>
            {/* Populate with slots */}
          </select>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setStatus('available')}
              style={{
                padding: '8px 16px',
                borderRadius: '16px',
                border: 'none',
                backgroundColor: status === 'available' ? 'var(--green)' : 'var(--bg-secondary)',
                color: status === 'available' ? '#fff' : 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              Available
            </button>
            <button
              onClick={() => setStatus('occupied')}
              style={{
                padding: '8px 16px',
                borderRadius: '16px',
                border: 'none',
                backgroundColor: status === 'occupied' ? 'var(--red)' : 'var(--bg-secondary)',
                color: status === 'occupied' ? '#fff' : 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              Occupied
            </button>
          </div>

          <input
            type="text"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="glass"
            style={{ padding: '12px', border: 'none', outline: 'none' }}
          />

          <select
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value))}
            className="glass"
            style={{ padding: '12px', border: 'none', outline: 'none' }}
          >
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-blue" onClick={handleSubmit}>Confirm</button>
        </div>
      </div>
    </div>
  );
};

export default ManualOverrideModal;
