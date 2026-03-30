import React, { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../../lib/auth';
import { apiUrl } from '../../lib/api';

const RESERVATION_DURATION_MINUTES = 15;

const createReservationWindow = () => {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + RESERVATION_DURATION_MINUTES * 60 * 1000);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};

const createInitialForm = () => ({
  lot_name: 'Main Lot',
  full_name: '',
  email: '',
  phone: '',
  license_plate: '',
  zone: 'A',
  slot_id: '',
  user_type: 'visitor',
  fallback_action: 'change_slot',
  notes: '',
});

const ReservationsPage = ({ token, user }) => {
  const [reservationWindow, setReservationWindow] = useState(() => createReservationWindow());
  const [reservations, setReservations] = useState([]);
  const [waitlistEntries, setWaitlistEntries] = useState([]);
  const [availability, setAvailability] = useState({
    total_slots: 0,
    reserved_slots: 0,
    occupied_slots: 0,
    available_slots: [],
    slot_states: [],
    should_waitlist: false,
    window_start: null,
    window_end: null,
  });
  const [form, setForm] = useState(() => createInitialForm());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [paymentConfig, setPaymentConfig] = useState({ enabled: false, receiver_name: '', qr_code: '', instructions: '', provider: 'admin_qr' });
  const [activePayment, setActivePayment] = useState(null);
  const [lots, setLots] = useState([]);
  const canManage = user?.role === 'admin' || user?.role === 'operator';
  const isAdmin = user?.role === 'admin';

  const handleMarkPaidDirect = async (reservationId) => {
    setError('');
    setStatus('');
    try {
      const response = await authFetch(`/payments/reservations/${reservationId}/checkout`, { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to get payment record');
      
      if (payload.payment?.id) {
        const markResponse = await authFetch(`/payments/${payload.payment.id}/mark-paid`, { method: 'POST' }, token);
        const markPayload = await markResponse.json();
        if (!markResponse.ok) throw new Error(markPayload.detail || 'Failed to mark as paid');
        setStatus(`Payment marked as paid!`);
      } else {
        setStatus(`Reservation confirmed (no payment required)`);
      }
      refreshAll();
    } catch (err) {
      setError(err.message || 'Failed to update payment status');
    }
  };

  const loadReservations = async () => {
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set('search', search.trim());
      const response = await authFetch(`/reservations?${query.toString()}`, {}, token);
      const payload = await response.json();
      setReservations(payload.reservations || []);
    } catch (err) {
      setError(err.message || 'Failed to load reservations');
    }
  };

  const loadWaitlist = async () => {
    if (!canManage) return;
    try {
      const response = await authFetch('/waitlist?status=waiting', {}, token);
      const payload = await response.json();
      setWaitlistEntries(payload.entries || []);
    } catch {
      setWaitlistEntries([]);
    }
  };

  const loadAvailability = async (zone) => {
    try {
      const query = new URLSearchParams();
      if (zone) query.set('zone', zone);
      const response = await fetch(apiUrl(`/public/slots/live`));
      const payload = await response.json();
      setAvailability({
        total_slots: payload.total_slots || 0,
        reserved_slots: payload.reserved || 0,
        occupied_slots: payload.occupied || 0,
        available_slots: [],
        slot_states: payload.slot_states || [],
        should_waitlist: false,
        window_start: null,
        window_end: null,
      });
    } catch {
      setAvailability({
        total_slots: 0,
        reserved_slots: 0,
        occupied_slots: 0,
        available_slots: [],
        slot_states: [],
        should_waitlist: false,
        window_start: null,
        window_end: null,
      });
    }
  };

  useEffect(() => {
    loadReservations();
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadWaitlist();
  }, [token, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fetchLots = async () => {
      try {
        const response = await authFetch('/lots', {}, token);
        const payload = await response.json();
        setLots(payload.lots || []);
      } catch {
        setLots([]);
      }
    };
    fetchLots();
  }, [token]);

  useEffect(() => {
    const fetchPaymentConfig = async () => {
      try {
        const response = await authFetch('/payments/config', {}, token);
        const payload = await response.json();
        setPaymentConfig({
          enabled: Boolean(payload.enabled),
          receiver_name: payload.receiver_name || '',
          qr_code: payload.qr_code || '',
          instructions: payload.instructions || '',
          provider: payload.provider || 'admin_qr',
        });
      } catch {
        setPaymentConfig({ enabled: false, receiver_name: '', qr_code: '', instructions: '', provider: 'admin_qr' });
      }
    };
    fetchPaymentConfig();
  }, [token]);

  useEffect(() => {
    loadAvailability(form.zone);
    const id = setInterval(() => {
      const nextWindow = createReservationWindow();
      setReservationWindow(nextWindow);
    }, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAvailability(form.zone);
    const id = setInterval(() => loadAvailability(form.zone), 4_000);
    return () => clearInterval(id);
  }, [form.zone, reservationWindow.startIso, reservationWindow.endIso]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.slot_id) return;
    const slotStillVisible = availability.slot_states.some((slot) => slot.slot_id === form.slot_id);
    if (!slotStillVisible) {
      setForm((prev) => ({ ...prev, slot_id: '' }));
    }
  }, [availability.slot_states, form.slot_id]);

  const slotStates = useMemo(() => availability.slot_states || [], [availability.slot_states]);
  const selectedSlotState = useMemo(
    () => slotStates.find((slot) => slot.slot_id === form.slot_id) || null,
    [slotStates, form.slot_id]
  );
  const alternativeSlots = useMemo(
    () => slotStates.filter((slot) => slot.state === 'available' && slot.slot_id !== form.slot_id),
    [slotStates, form.slot_id]
  );
  const autoWaitlist = availability.should_waitlist || availability.available_slots.length === 0;
  const effectiveFallbackAction = autoWaitlist ? 'waitlist' : form.fallback_action;
  const availabilitySummary = useMemo(
    () => [
      { label: 'Configured', value: availability.total_slots },
      { label: 'Occupied', value: availability.occupied_slots },
      { label: 'Reserved', value: availability.reserved_slots },
      { label: 'Free Now', value: availability.available_slots.length },
    ],
    [availability]
  );

  const refreshAll = () => {
    loadReservations();
    loadWaitlist();
    loadAvailability(form.zone);
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');
    try {
      const response = await authFetch('/reservations', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          start_time: reservationWindow.startIso,
          end_time: reservationWindow.endIso,
          fallback_action: effectiveFallbackAction,
          allow_waitlist: effectiveFallbackAction === 'waitlist' || autoWaitlist,
        }),
      }, token);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || 'Failed to create reservation');
      }

      if (payload.waitlist) {
        setStatus(`No free slot for the next ${RESERVATION_DURATION_MINUTES} minutes. ${payload.waitlist.full_name} was added to the waitlist.`);
      } else {
        const slotMessage = payload.slot_changed ? ' Requested slot was occupied, so the system changed to another free slot.' : '';
        setStatus(`Reservation created for ${payload.reservation.slot_id}. It will expire automatically after ${RESERVATION_DURATION_MINUTES} minutes.${slotMessage}`);
      }

      setForm((prev) => ({
        ...createInitialForm(),
        lot_name: prev.lot_name,
        zone: prev.zone,
      }));
      setReservationWindow(createReservationWindow());
      refreshAll();
    } catch (err) {
      setError(err.message || 'Failed to create reservation');
    }
  };

  const handleCancel = async (reservationId) => {
    setError('');
    setStatus('');
    try {
      const response = await authFetch(`/reservations/${reservationId}/cancel`, { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to cancel reservation');
      setStatus(`Reservation ${payload.reservation.confirmation_code} cancelled.`);
      refreshAll();
    } catch (err) {
      setError(err.message || 'Failed to cancel reservation');
    }
  };

  const handlePay = async (reservationId) => {
    setError('');
    setStatus('');
    try {
      const response = await authFetch(`/payments/reservations/${reservationId}/checkout`, { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to start payment');
      setActivePayment(payload.payment_request || null);
      setStatus(`Payment request prepared for reservation ${payload.payment_request?.reservation_code || reservationId}.`);
    } catch (err) {
      setError(err.message || 'Failed to start payment');
    }
  };

  const handleMarkPaid = async () => {
    if (!activePayment?.payment_id) return;
    setError('');
    setStatus('');
    try {
      const response = await authFetch(`/payments/${activePayment.payment_id}/mark-paid`, { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to confirm payment');
      setStatus(`Payment marked as paid for reservation ${payload.reservation?.confirmation_code || activePayment.reservation_code}.`);
      setActivePayment(null);
      loadReservations();
    } catch (err) {
      setError(err.message || 'Failed to confirm payment');
    }
  };

  const handlePromoteWaitlist = async (entryId) => {
    setError('');
    setStatus('');
    try {
      const response = await authFetch(`/waitlist/${entryId}/promote`, { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to promote waitlist entry');
      setStatus(`Waitlist promoted to reservation ${payload.reservation.confirmation_code}.`);
      refreshAll();
    } catch (err) {
      setError(err.message || 'Failed to promote waitlist entry');
    }
  };

  const handleCancelWaitlist = async (entryId) => {
    setError('');
    setStatus('');
    try {
      const response = await authFetch(`/waitlist/${entryId}/cancel`, { method: 'POST' }, token);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to cancel waitlist entry');
      setStatus(`Cancelled waitlist entry for ${payload.entry.full_name}.`);
      loadWaitlist();
    } catch (err) {
      setError(err.message || 'Failed to cancel waitlist entry');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>Reservations</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Reservations start immediately, last <strong>{RESERVATION_DURATION_MINUTES} minutes</strong>, follow live occupancy, and expire automatically.
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, guest, plate, slot"
          style={{ minWidth: '280px', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-primary)' }}
        />
      </div>

      {(status || error) && (
        <div className="glass" style={{ padding: '14px 16px', marginBottom: '20px', border: `1px solid ${error ? 'rgba(231,76,60,0.28)' : 'rgba(46,204,113,0.25)'}`, color: error ? '#ffb4aa' : '#b8ffd9' }}>
          {error || status}
        </div>
      )}

      {canManage && !paymentConfig.enabled && (
        <div className="glass" style={{ padding: '16px 18px', marginBottom: '20px', border: '1px solid rgba(241,196,15,0.24)', color: '#ffe29a' }}>
          Admin test payment QR is not configured. Open Settings and add the Alipay QR code before using reservation payments.
        </div>
      )}

      {activePayment && (
        <div className="glass" style={{ padding: '20px', marginBottom: '20px', border: '1px solid rgba(52,152,219,0.24)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr)', gap: '20px', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '12px', justifyItems: 'center' }}>
              {looksLikeImageSource(activePayment.qr_code) ? (
                <img
                  src={activePayment.qr_code}
                  alt="Admin payment QR"
                  style={{ width: '100%', maxWidth: '220px', aspectRatio: '1 / 1', objectFit: 'contain', borderRadius: '16px', background: '#fff', padding: '12px' }}
                />
              ) : (
                <div style={{ width: '100%', minHeight: '220px', borderRadius: '16px', background: 'rgba(255,255,255,0.04)', border: '1px dashed var(--panel-border)', color: 'var(--text-muted)', padding: '16px', display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: '13px' }}>
                  QR image unavailable
                </div>
              )}
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
                Scan with Alipay on a phone for test checkout.
              </div>
            </div>
            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>Test Alipay Payment</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                  Reservation <strong>{activePayment.reservation_code}</strong> · Receiver <strong>{activePayment.receiver_name}</strong>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                <InfoCard label="Amount" value={`${activePayment.amount?.toFixed?.(2) || activePayment.amount} ${activePayment.currency || 'USD'}`} />
                <InfoCard label="Method" value="Alipay QR" />
                <InfoCard label="Status" value={activePayment.status || 'pending'} />
              </div>
              <div style={{ padding: '14px 16px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.7 }}>
                {activePayment.instructions}
              </div>
              {!looksLikeImageSource(activePayment.qr_code) && activePayment.qr_code && (
                <textarea readOnly value={activePayment.qr_code} rows={4} style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }} />
              )}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {user?.role === 'cashier' && (
                  <button onClick={handleMarkPaid} style={primaryButtonStyle}>Mark as Paid</button>
                )}
                <button onClick={() => setActivePayment(null)} style={ghostButtonStyle}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
        {canManage && (
          <div className="glass" style={{ padding: '20px', marginBottom: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Reservation Overview</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px', marginBottom: '16px' }}>
              {availabilitySummary.map((item) => (
                <InfoCard key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
            <div style={{ padding: '12px', borderRadius: '12px', background: 'rgba(52,152,219,0.08)', border: '1px solid rgba(52,152,219,0.18)', color: '#d7f0ff', fontSize: '13px', lineHeight: 1.7 }}>
              Reservation window: <strong>{formatWindow(availability.window_start || reservationWindow.startIso, availability.window_end || reservationWindow.endIso)}</strong>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: '20px' }}>
          <div className="glass" style={{ padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Live Slot State</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              {slotStates.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No slot data available yet.</div>
              )}
              {slotStates.map((slot) => (
                <div key={slot.slot_id} style={{ ...slotCardStyle(slot.state), boxShadow: form.slot_id === slot.slot_id ? '0 0 0 2px rgba(255,255,255,0.14) inset' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontSize: '15px', fontWeight: 700 }}>{slot.slot_id}</div>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85 }}>{slot.state}</div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '8px' }}>Zone {slot.zone}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass" style={{ padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Booked Sessions</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Code', 'Guest', 'Slot', 'Window', 'Plate', 'Status', 'Payment', ''].map((label) => (
                      <th key={label} style={thStyle}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reservations.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>No reservations found.</td>
                    </tr>
                  )}
                  {reservations.map((reservation) => (
                    <tr key={reservation.id}>
                      <td style={tdStyle}>{reservation.confirmation_code}</td>
                      <td style={tdStyle}>{reservation.full_name}</td>
                      <td style={tdStyle}>{reservation.slot_id || 'Auto'} / {reservation.zone || 'A'}</td>
                      <td style={tdStyle}>{formatWindow(reservation.start_time, reservation.end_time)}</td>
                      <td style={tdStyle}>{reservation.license_plate || '—'}</td>
                      <td style={tdStyle}>{reservation.status}</td>
                      <td style={tdStyle}>{reservation.payment_status}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {isAdmin && reservation.status !== 'cancelled' && reservation.status !== 'expired' && reservation.payment_status !== 'paid' && (
                          <button
                            onClick={() => handleMarkPaidDirect(reservation.id)}
                            style={{ ...smallButtonStyle, marginRight: '8px', borderColor: 'rgba(16,185,129,0.28)', color: '#6ee7b7' }}
                          >
                            Mark Paid
                          </button>
                        )}
                        {canManage && reservation.status !== 'cancelled' && reservation.status !== 'expired' && reservation.payment_status !== 'paid' && (
                          <button
                            onClick={() => handlePay(reservation.id)}
                            disabled={!paymentConfig.enabled}
                            style={{ ...smallButtonStyle, marginRight: '8px', borderColor: 'rgba(52,152,219,0.28)', color: paymentConfig.enabled ? '#b7e3ff' : 'var(--text-muted)' }}
                          >
                            Pay
                          </button>
                        )}
                        {canManage && reservation.status !== 'cancelled' && reservation.status !== 'expired' && (
                          <button onClick={() => handleCancel(reservation.id)} style={{ ...smallButtonStyle, borderColor: 'rgba(231,76,60,0.28)', color: '#ffb4aa' }}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {canManage && (
            <div className="glass" style={{ padding: '20px' }}>
              <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Waitlist Queue</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Guest', 'Slot Request', 'Window', 'Zone', 'Status', ''].map((label) => (
                        <th key={label} style={thStyle}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {waitlistEntries.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>No waitlist entries.</td>
                      </tr>
                    )}
                    {waitlistEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td style={tdStyle}>{entry.full_name}</td>
                        <td style={tdStyle}>{entry.license_plate || '—'}</td>
                        <td style={tdStyle}>{formatWindow(entry.start_time, entry.end_time)}</td>
                        <td style={tdStyle}>{entry.zone || 'A'}</td>
                        <td style={tdStyle}>{entry.status}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <button onClick={() => handlePromoteWaitlist(entry.id)} style={{ ...smallButtonStyle, marginRight: '8px', borderColor: 'rgba(52,152,219,0.28)', color: '#b7e3ff' }}>
                            Promote
                          </button>
                          <button onClick={() => handleCancelWaitlist(entry.id)} style={{ ...smallButtonStyle, borderColor: 'rgba(231,76,60,0.28)', color: '#ffb4aa' }}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
  verticalAlign: 'top',
};

const primaryButtonStyle = {
  padding: '12px 16px',
  borderRadius: '12px',
  border: 'none',
  background: 'linear-gradient(135deg, #2ECC71, #3498DB)',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostButtonStyle = {
  padding: '12px 16px',
  borderRadius: '12px',
  border: '1px solid var(--panel-border)',
  background: 'rgba(255,255,255,0.03)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

const smallButtonStyle = {
  padding: '8px 10px',
  borderRadius: '10px',
  border: '1px solid',
  background: 'rgba(255,255,255,0.04)',
  cursor: 'pointer',
};

const radioLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: 'var(--text-secondary)',
  fontSize: '13px',
};

const looksLikeImageSource = (value) => typeof value === 'string' && /^(https?:\/\/|data:image\/|\/)/i.test(value.trim());

const InfoCard = ({ label, value }) => (
  <div style={{ padding: '12px 14px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
    <div style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
    <div style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 700 }}>{value}</div>
  </div>
);

const slotCardStyle = (state) => {
  const palette = {
    available: { background: 'rgba(46,204,113,0.10)', border: 'rgba(46,204,113,0.24)' },
    occupied: { background: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.24)' },
    reserved: { background: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.24)' },
  };
  const tone = palette[state] || palette.available;
  return {
    padding: '14px',
    borderRadius: '14px',
    background: tone.background,
    border: `1px solid ${tone.border}`,
  };
};

const formatWindow = (startTime, endTime) => {
  const start = startTime ? new Date(startTime) : null;
  const end = endTime ? new Date(endTime) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  return `${start.toLocaleString()} → ${end.toLocaleString()}`;
};

export default ReservationsPage;
