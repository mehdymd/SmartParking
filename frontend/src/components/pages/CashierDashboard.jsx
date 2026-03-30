import React, { useState, useEffect } from 'react';
import { apiUrl } from '../../lib/api';
import { authFetch } from '../../lib/auth';
import { Search, DollarSign, CreditCard, Car, CheckCircle, Clock, Receipt, LogOut } from 'lucide-react';

const CashierDashboard = ({ currentUser, token, onLogout }) => {
  const [activeTab, setActiveTab] = useState('search');
  const [searchCode, setSearchCode] = useState('');
  const [searchPlate, setSearchPlate] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupPayment, setLookupPayment] = useState(null);
  const [todayPayments, setTodayPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadTodayPayments();
  }, []);

  const loadTodayPayments = async () => {
    try {
      const response = await authFetch('/cash-payments', {}, token);
      const data = await response.json();
      setTodayPayments(data.cash_payments || []);
    } catch {}
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchCode.trim() && !searchPlate.trim()) return;

    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const query = new URLSearchParams();
      if (searchCode.trim()) query.set('confirmation_code', searchCode.trim().toUpperCase());
      if (searchPlate.trim()) query.set('license_plate', searchPlate.trim().toUpperCase());

      const response = await fetch(apiUrl(`/public/reservations/lookup?${query.toString()}`));
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.detail || 'Reservation not found');
      setLookupResult(payload.reservation);
      setLookupPayment(payload.payment || null);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setLookupResult(null);
      setLookupPayment(null);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!lookupPayment?.payment_id) return;
    setLoading(true);
    try {
      const response = await authFetch(`/payments/${lookupPayment.payment_id}/mark-paid`, { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to confirm payment');
      setMessage({ type: 'success', text: 'Payment confirmed successfully!' });
      setLookupPayment(null);
      setLookupResult(null);
      loadTodayPayments();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchCode('');
    setSearchPlate('');
    setLookupResult(null);
    setLookupPayment(null);
    setMessage({ type: '', text: '' });
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: '22px', fontWeight: '700', margin: 0 }}>
            💰 Cashier Portal
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '13px', margin: '4px 0 0 0' }}>
            Welcome, {currentUser?.full_name || currentUser?.username || 'Cashier'}
          </p>
        </div>
        <button
          onClick={onLogout}
          style={{
            background: 'rgba(239,68,68,0.2)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5',
            padding: '8px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <LogOut size={16} /> Logout
        </button>
      </div>

      {/* Message */}
      {message.text && (
        <div style={{
          margin: '16px 20px 0',
          padding: '12px 16px',
          borderRadius: '10px',
          background: message.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
          border: `1px solid ${message.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
          color: message.type === 'error' ? '#fca5a5' : '#6ee7b7',
          fontSize: '14px',
        }}>
          {message.text}
        </div>
      )}

      {/* Search Section */}
      <div style={{ padding: '20px' }}>
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '20px',
        }}>
          <h2 style={{ color: '#fff', fontSize: '16px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Search size={18} /> Find Reservation
          </h2>
          
          <form onSubmit={handleSearch}>
            <div style={{ display: 'grid', gap: '12px' }}>
              <input
                type="text"
                placeholder="Confirmation Code (e.g., RES-ABC123)"
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value.toUpperCase())}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  color: '#fff',
                  fontSize: '15px',
                  outline: 'none',
                }}
              />
              <div style={{ textAlign: 'center', color: '#475569', fontSize: '13px' }}>— OR —</div>
              <input
                type="text"
                placeholder="License Plate (e.g., ABC123)"
                value={searchPlate}
                onChange={(e) => setSearchPlate(e.target.value.toUpperCase())}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  color: '#fff',
                  fontSize: '15px',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={loading || (!searchCode.trim() && !searchPlate.trim())}
                style={{
                  background: loading ? '#475569' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '14px',
                  color: '#fff',
                  fontSize: '15px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginTop: '8px',
                }}
              >
                {loading ? 'Searching...' : '🔍 Search'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Result Section */}
      {lookupResult && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            padding: '20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: '600', margin: 0 }}>Reservation Found</h3>
              <button
                onClick={clearSearch}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                ✕ Clear
              </button>
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>Code</span>
                <span style={{ color: '#fff', fontSize: '14px', fontWeight: '600' }}>{lookupResult.confirmation_code}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>Guest</span>
                <span style={{ color: '#fff', fontSize: '14px' }}>{lookupResult.full_name || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>License Plate</span>
                <span style={{ color: '#fff', fontSize: '14px' }}>{lookupResult.license_plate || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>Slot</span>
                <span style={{ color: '#fff', fontSize: '14px' }}>{lookupResult.slot_id || 'Auto'} ({lookupResult.zone || 'A'})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>Status</span>
                <span style={{ 
                  color: lookupResult.status === 'confirmed' ? '#22c55e' : '#f59e0b', 
                  fontSize: '14px',
                  textTransform: 'capitalize',
                }}>
                  {lookupResult.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>Payment</span>
                <span style={{ 
                  color: lookupResult.payment_status === 'paid' ? '#22c55e' : '#f59e0b', 
                  fontSize: '14px',
                  textTransform: 'capitalize',
                }}>
                  {lookupResult.payment_status || 'pending'}
                </span>
              </div>
            </div>

            {/* Payment Actions */}
            {lookupResult.payment_status !== 'paid' && (
              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                {lookupPayment && lookupPayment.qr_code && (
                  <div style={{ marginBottom: '16px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#fff', marginBottom: '12px' }}>📱 Alipay QR Payment</div>
                    {lookupPayment.qr_code?.startsWith('http') ? (
                      <img 
                        src={lookupPayment.qr_code} 
                        alt="QR Code" 
                        style={{ width: '140px', height: '140px', borderRadius: '8px', display: 'block', margin: '0 auto 12px' }} 
                      />
                    ) : null}
                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                      Amount: <strong style={{ color: '#fff' }}>¥{lookupPayment.amount}</strong>
                    </div>
                    <button
                      onClick={handleMarkPaid}
                      disabled={loading}
                      style={{
                        width: '100%',
                        marginTop: '12px',
                        padding: '14px',
                        background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                        border: 'none',
                        borderRadius: '10px',
                        color: '#fff',
                        fontSize: '15px',
                        fontWeight: '600',
                        cursor: loading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      ✓ Confirm Alipay Payment
                    </button>
                  </div>
                )}
              </div>
            )}

            {lookupResult.payment_status === 'paid' && (
              <div style={{
                marginTop: '20px',
                padding: '20px',
                background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: '12px',
                textAlign: 'center',
              }}>
                <CheckCircle size={32} style={{ color: '#22c55e', marginBottom: '8px' }} />
                <div style={{ color: '#22c55e', fontSize: '15px', fontWeight: '600' }}>Already Paid</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Today's Payments */}
      <div style={{ padding: '0 20px 40px' }}>
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '20px',
        }}>
          <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Receipt size={18} /> Today's Payments
          </h3>
          
          {todayPayments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
              No payments today
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {todayPayments.slice(0, 10).map((payment) => (
                <div key={payment.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 14px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '10px',
                }}>
                  <div>
                    <div style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>
                      ${payment.amount?.toFixed(2)}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>
                      Res #{payment.reservation_id}
                    </div>
                  </div>
                  <div style={{ color: '#64748b', fontSize: '12px' }}>
                    {payment.created_at ? new Date(payment.created_at).toLocaleTimeString() : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CashierDashboard;
