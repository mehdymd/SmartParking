import React, { useState, useEffect } from 'react';
import { Bell, Settings } from 'lucide-react';

const Header = ({ currentPage, setCurrentPage }) => {
  const [sessionTime, setSessionTime] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSessionTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const pageNames = {
    'SlotEditor': 'Slot Editor',
    'LPR': 'LPR',
    'Revenue': 'Revenue',
    'Alerts': 'Alerts',
    'Settings': 'Settings'
  };

  const pages = ['Dashboard', 'Analytics', 'SlotEditor', 'Revenue', 'Alerts', 'Settings'];

  return (
    <header style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: '80px',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 30px',
      boxSizing: 'border-box'
    }} className="glass">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="30" height="30" rx="4" fill="var(--blue)" />
          <text x="15" y="20" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold">P</text>
        </svg>
        <span style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)' }}>SmartParking</span>
      </div>

      <nav style={{ display: 'flex', gap: '24px' }}>
        {pages.map(page => (
          <button
            key={page}
            onClick={() => setCurrentPage(page)}
            style={{
              background: 'none',
              border: 'none',
              color: currentPage === page ? 'var(--text-primary)' : 'var(--text-muted)',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              padding: '8px 0',
              borderBottom: currentPage === page ? '2px solid var(--blue)' : 'none',
              transition: 'color 0.2s'
            }}
          >
            {page}
          </button>
        ))}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--green)',
            animation: 'pulse 2s infinite'
          }}></div>
          <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>System Status: Online</span>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>
          Session: {formatTime(sessionTime)}
        </span>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative' }} onClick={() => setCurrentPage('Alerts')}>
          <Bell size={16} color="var(--text-primary)" />
          <div style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: 'var(--red)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '8px',
            color: 'white'
          }}>
            3
          </div>
        </button>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: 'var(--blue)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: '14px',
          fontWeight: 'bold'
        }}>
          SP
        </div>
      </div>

      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}
      </style>
    </header>
  );
};

export default Header;
