import React, { useState } from 'react';
import { apiUrl } from '../../lib/api';

const LoginPage = ({ onLogin }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('test123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Login failed');
      }
      onLogin(payload);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: '32px 16px',
      background: 'radial-gradient(circle at top left, rgba(52,152,219,0.18), transparent 35%), radial-gradient(circle at bottom right, rgba(46,204,113,0.12), transparent 30%), #0b111b'
    }}>
      <div className="glass" style={{ width: '100%', maxWidth: '460px', padding: '28px', borderRadius: '18px' }}>
        <div style={{ marginBottom: '22px' }}>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>SmartParking Access</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Sign in to manage the lot dashboard, reservations, analytics, and role-based operations.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(7,12,20,0.75)', color: 'var(--text-primary)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(7,12,20,0.75)', color: 'var(--text-primary)' }}
            />
          </label>

          {error && (
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.24)', color: '#ffb4aa', fontSize: '13px' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: '8px', padding: '12px 16px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg, #3498DB, #1ABC9C)', color: 'white', fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
