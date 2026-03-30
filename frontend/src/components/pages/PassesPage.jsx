import React, { useEffect, useState } from 'react';
import { authFetch } from '../../lib/auth';

const PassesPage = ({ token, user }) => {
  const [catalog, setCatalog] = useState([]);
  const [passes, setPasses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [lots, setLots] = useState([]);
  const [config, setConfig] = useState({ enabled: false });
  const [form, setForm] = useState({
    full_name: user?.full_name || user?.username || '',
    email: user?.username || '',
    phone: '',
    license_plate: '',
    lot_name: 'Main Lot',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    try {
      const [configRes, passesRes, paymentsRes] = await Promise.all([
        authFetch('/payments/config', {}, token),
        authFetch('/monthly-passes', {}, token),
        authFetch('/payments?limit=20', {}, token),
      ]);
      const [configPayload, passesPayload, paymentsPayload] = await Promise.all([
        configRes.json(),
        passesRes.json(),
        paymentsRes.json(),
      ]);
      setConfig(configPayload || {});
      setCatalog(passesPayload.catalog || configPayload.monthly_pass_catalog || []);
      setPasses(passesPayload.passes || []);
      setPayments((paymentsPayload.payments || []).filter((item) => item.payment_type === 'monthly_pass'));
    } catch (err) {
      setError(err.message || 'Failed to load pass data');
    }
  };

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loadLots = async () => {
      try {
        const response = await authFetch('/lots', {}, token);
        const payload = await response.json();
        setLots(payload.lots || []);
      } catch {
        setLots([]);
      }
    };
    loadLots();
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const passId = params.get('pass_id');
    if (checkout === 'success') {
      setMessage(`Monthly pass checkout completed${passId ? ` for pass ${passId}` : ''}.`);
    } else if (checkout === 'cancelled') {
      setError(`Monthly pass checkout was cancelled${passId ? ` for pass ${passId}` : ''}.`);
    }
  }, []);

  const startCheckout = async (planId) => {
    setError('');
    setMessage('');
    try {
      const response = await authFetch('/monthly-passes/checkout', {
        method: 'POST',
        body: JSON.stringify({ ...form, plan_id: planId }),
      }, token);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Failed to start checkout');
      }
      window.location.href = payload.checkout_url;
    } catch (err) {
      setError(err.message || 'Failed to start checkout');
    }
  };

  const openBillingPortal = async () => {
    setError('');
    setMessage('');
    try {
      const response = await authFetch('/payments/billing-portal', { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Billing portal unavailable');
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(err.message || 'Billing portal unavailable');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Monthly Passes</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Recurring card billing for regular parkers. Alipay remains available for one-time reservation checkout only.
          </p>
        </div>
        <button
          onClick={openBillingPortal}
          disabled={!passes.length}
          style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--panel-border)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary)', cursor: passes.length ? 'pointer' : 'not-allowed' }}
        >
          Manage Billing
        </button>
      </div>

      {!config.enabled && (
        <div className="glass" style={{ padding: '16px', marginBottom: '20px', color: '#ffd4a3', border: '1px solid rgba(245,158,11,0.22)' }}>
          Stripe is not configured yet. Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` on the backend before using checkout.
        </div>
      )}

      {(message || error) && (
        <div className="glass" style={{ padding: '14px 16px', marginBottom: '20px', border: `1px solid ${error ? 'rgba(231,76,60,0.28)' : 'rgba(46,204,113,0.25)'}`, color: error ? '#ffb4aa' : '#b8ffd9' }}>
          {error || message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '380px minmax(0,1fr)', gap: '20px' }}>
        <div className="glass" style={{ padding: '20px', alignSelf: 'start' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Pass Holder Details</div>
          <div style={{ display: 'grid', gap: '12px' }}>
            <input value={form.full_name} onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))} placeholder="Full name" style={fieldStyle} />
            <input value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" style={fieldStyle} />
            <input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="Phone" style={fieldStyle} />
            <input value={form.license_plate} onChange={(e) => setForm((prev) => ({ ...prev, license_plate: e.target.value.toUpperCase() }))} placeholder="Primary plate" style={fieldStyle} />
            <select value={form.lot_name} onChange={(e) => setForm((prev) => ({ ...prev, lot_name: e.target.value }))} style={fieldStyle}>
              {(lots.length ? lots : [{ name: 'Main Lot' }]).map((lot) => (
                <option key={lot.name} value={lot.name}>{lot.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '20px' }}>
          <div className="glass" style={{ padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Plans</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              {catalog.map((plan) => (
                <div key={plan.id} style={{ borderRadius: '16px', padding: '18px', background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Zone {plan.zone}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: '8px 0 6px' }}>{plan.name}</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#9fe6ff' }}>${Number(plan.amount || 0).toFixed(2)}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>per {plan.interval}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '10px', minHeight: '38px' }}>{plan.description}</div>
                  <button
                    onClick={() => startCheckout(plan.id)}
                    disabled={!config.enabled}
                    style={{ width: '100%', marginTop: '16px', padding: '11px 14px', borderRadius: '12px', border: 'none', background: config.enabled ? 'linear-gradient(135deg, #3498DB, #6DD5FA)' : 'rgba(255,255,255,0.08)', color: 'white', cursor: config.enabled ? 'pointer' : 'not-allowed', fontWeight: 700 }}
                  >
                    Subscribe
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="glass" style={{ padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Your Passes</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Plan', 'Zone', 'Status', 'Period End', 'Plate'].map((label) => (
                    <th key={label} style={thStyle}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {passes.length === 0 && (
                  <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>No passes yet.</td></tr>
                )}
                {passes.map((item) => (
                  <tr key={item.id}>
                    <td style={tdStyle}>{item.plan_name}</td>
                    <td style={tdStyle}>{item.zone}</td>
                    <td style={tdStyle}>{item.status}</td>
                    <td style={tdStyle}>{item.current_period_end ? new Date(item.current_period_end).toLocaleString() : '—'}</td>
                    <td style={tdStyle}>{item.license_plate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="glass" style={{ padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Recent Pass Payments</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Amount', 'Status', 'Method', 'Paid At'].map((label) => (
                    <th key={label} style={thStyle}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>No pass payment records yet.</td></tr>
                )}
                {payments.map((item) => (
                  <tr key={item.id}>
                    <td style={tdStyle}>${Number(item.amount || 0).toFixed(2)} {String(item.currency || 'usd').toUpperCase()}</td>
                    <td style={tdStyle}>{item.status}</td>
                    <td style={tdStyle}>{item.payment_method || 'card'}</td>
                    <td style={tdStyle}>{item.paid_at ? new Date(item.paid_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const fieldStyle = {
  padding: '12px 14px',
  borderRadius: '12px',
  border: '1px solid var(--panel-border)',
  background: 'var(--panel-bg)',
  color: 'var(--text-primary)',
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

export default PassesPage;
