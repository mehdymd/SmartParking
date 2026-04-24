import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../../lib/api';
import { Car, Search, Calendar, AlertTriangle, Plus, MapPin, Home, CreditCard, X, Image } from 'lucide-react';
import QRCodeImage from '../QRCodeImage';
import './MobilePortal.css';

const defaultData = {
  title: 'SmartParking Access',
  tagline: 'Reserve, monitor, pay, and manage parking',
  stats: { available: 0, reserved: 0, occupied: 0, total_slots: 0, occupancy_rate: 0 },
  payments: { enabled: false, method: 'alipay_qr', receiver_name: '', qr_code: '', instructions: '' },
  zone_pricing: {},
  zone_duration: {},
};

const getZoneRates = (zonePricing, zoneDuration) => {
  const pricing = zonePricing || { A: 2, B: 1, C: 4 };
  const duration = zoneDuration || { A: 1, B: 1, C: 1 };
  return [
    { zone: 'A', name: 'Zone A', label: 'Priority Access', hourly: pricing.A || 5, daily: (pricing.A || 5) * 8, monthly: 120, color: '#00D9D9', duration: duration.A || 1 },
    { zone: 'B', name: 'Zone B', label: 'Balanced Daily', hourly: pricing.B || 3, daily: (pricing.B || 3) * 8, monthly: 90, color: '#1F3A5F', duration: duration.B || 1 },
    { zone: 'C', name: 'Zone C', label: 'Premium Edge Bays', hourly: pricing.C || 4, daily: (pricing.C || 4) * 8, monthly: 180, color: '#F59E0B', duration: duration.C || 1 },
  ];
};

const emptyReservationForm = {
  full_name: '',
  email: '',
  phone: '',
  license_plate: '',
  zone: 'A',
  slot_id: '',
  payment_method: 'cash', // 'alipay' or 'cash'
};

const emptyPassForm = {
  plan_id: '',
  full_name: '',
  email: '',
  phone: '',
  license_plate: '',
};

const emptyIncidentForm = {
  reporter_name: '',
  title: '',
  description: '',
  severity: 'medium',
  category: 'general',
  slot_id: '',
  image_data: '',
};

const defaultPassCatalog = [
  { id: 'monthly-zone-a', name: 'Zone A Monthly Pass', zone: 'A', amount: 120, currency: 'cny', interval: 'month', description: 'Priority access' },
  { id: 'monthly-zone-b', name: 'Zone B Monthly Pass', zone: 'B', amount: 90, currency: 'cny', interval: 'month', description: 'Balanced daily parking' },
  { id: 'monthly-zone-c', name: 'Zone C Monthly Pass', zone: 'C', amount: 180, currency: 'cny', interval: 'month', description: 'Premium edge bays' },
];

const issueTypes = [
  { id: 'damage', label: 'Damage to Vehicle', icon: Car },
  { id: 'payment', label: 'Payment Error', icon: CreditCard },
  { id: 'system', label: 'System Issue', icon: AlertTriangle },
  { id: 'access', label: 'Access Problem', icon: X },
  { id: 'other', label: 'Other', icon: Plus },
];

const formatMoney = (amount) => {
  const numeric = Number(amount || 0);
  if (Number.isNaN(numeric)) return '0';
  return numeric % 1 === 0 ? String(numeric) : numeric.toFixed(2);
};

const looksLikeImageSource = (value) => typeof value === 'string' && /^(https?:\/\/|data:image\/|\/)/i.test(value.trim());

const reservationQrValue = (reservation) => {
  if (!reservation) return '';
  if (reservation.legacy_qr_data) return reservation.legacy_qr_data;
  if (reservation.qr_data && reservation.qr_data.startsWith('PARKING:')) return reservation.qr_data;
  if (reservation.confirmation_code) {
    return `PARKING:${reservation.confirmation_code}|${reservation.license_plate || ''}|${reservation.zone || ''}|${reservation.slot_id || ''}`;
  }
  return reservation.cashier_qr_data || reservation.qr_data || '';
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  try {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'N/A';
  }
};

const isReservationInUse = (reservation) => ['in_use', 'checked_in', 'active'].includes(String(reservation?.status || '').toLowerCase());

const lookupStatusTone = (reservation) => {
  const status = String(reservation?.status || '').toLowerCase();
  if (status === 'expired') return 'expired';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'confirmed') return 'confirmed';
  if (isReservationInUse(reservation)) return 'paid';
  if (String(reservation?.payment_status || '').toLowerCase() === 'paid') return 'paid';
  return 'pending';
};

const lookupStatusLabel = (reservation) => {
  const status = String(reservation?.status || '').toLowerCase();
  if (status === 'expired') return 'Expired';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'completed') return 'Completed';
  if (isReservationInUse(reservation)) return 'In Use';
  if (String(reservation?.payment_status || '').toLowerCase() === 'paid') return 'Paid';
  return 'Pending';
};

const MobilePortal = ({ activeTab = 'dashboard', onTabChange, user, onLogout }) => {
  const [data, setData] = useState(defaultData);
  const [liveSlots, setLiveSlots] = useState({ total_slots: 0, available: 0, occupied: 0, reserved: 0, slot_states: [] });
  const [availability, setAvailability] = useState({
    total_slots: 0,
    available_slots: [],
    slot_states: [],
    duration_minutes: 15,
  });
  const [incidents, setIncidents] = useState([]);
  const [passCatalog] = useState(defaultPassCatalog);
  const [userBookings, setUserBookings] = useState([]);
  
  const [reservationForm, setReservationForm] = useState(emptyReservationForm);
  const [passForm, setPassForm] = useState(emptyPassForm);
  const [incidentForm, setIncidentForm] = useState(emptyIncidentForm);
  
  useEffect(() => {
    if (user?.phone) {
      setIncidentForm(prev => ({ ...prev, reporter_name: user.phone }));
      setReservationForm(prev => ({ ...prev, phone: user.phone, full_name: user.full_name || '' }));
    }
  }, [user]);
  
  const [lookupMode, setLookupMode] = useState('license_plate');
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupPayment, setLookupPayment] = useState(null); // eslint-disable-line no-unused-vars
  const [reservationResult, setReservationResult] = useState(null);
  const [paymentSheet, setPaymentSheet] = useState(null);
  const [flash, setFlash] = useState({ tone: '', text: '' });
  const [busyKey, setBusyKey] = useState('');
  const [selectedZone, setSelectedZone] = useState('A');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedDuration, setSelectedDuration] = useState('hourly');

  useEffect(() => {
    if (flash.text) {
      const timer = setTimeout(() => {
        setFlash({ tone: '', text: '' });
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [flash.text]);

  const setMessage = (tone, text) => {
    setFlash({ tone, text });
  };

  const loadPortal = async () => {
    try {
      const response = await fetch(apiUrl('/public/access-portal'));
      const payload = await response.json();
      if (response.ok) {
        setData({ 
          ...defaultData, 
          ...payload, 
          stats: { ...defaultData.stats, ...(payload.stats || {}) },
          zone_pricing: payload.zone_pricing || {},
          zone_duration: payload.zone_duration || {},
        });
      }
    } catch {}
  };

  const loadLiveSlots = async () => {
    try {
      const response = await fetch(apiUrl('/public/slots/live'));
      const payload = await response.json();
      if (response.ok) {
        setLiveSlots({
          total_slots: payload.total_slots || 0,
          available: payload.available || 0,
          occupied: payload.occupied || 0,
          reserved: payload.reserved || 0,
          slot_states: payload.slot_states || [],
        });
      }
    } catch {}
  };

  const loadAvailability = async () => {
    try {
      const response = await fetch(apiUrl('/public/reservations/availability'));
      const payload = await response.json();
      if (response.ok) {
        setAvailability({
          total_slots: payload.total_slots || 0,
          available_slots: payload.available_slots || [],
          slot_states: payload.slot_states || [],
          duration_minutes: payload.duration_minutes || 15,
        });
      }
    } catch {}
  };

  const loadIncidents = async () => {
    try {
      const phone = user?.phone || '';
      if (!phone) {
        setIncidents([]);
        return;
      }
      const response = await fetch(apiUrl(`/public/incidents?reporter=${encodeURIComponent(phone)}`));
      const payload = await response.json();
      if (response.ok) {
        setIncidents(payload.incidents || []);
      }
    } catch {}
  };

  const [activeSession, setActiveSession] = useState(null);

  const loadUserBookings = async () => {
    try {
      const phone = user?.phone || reservationForm.phone || '';
      const licensePlate = user?.license_plate || reservationForm.license_plate || '';
      
      if (!phone && !licensePlate) {
        return;
      }
      
      if (phone) {
        const response = await fetch(apiUrl(`/public/reservations/by-phone?phone=${encodeURIComponent(phone)}`));
        const payload = await response.json();
        if (response.ok && payload.reservations?.length > 0) {
          setUserBookings(payload.reservations);
          return;
        }
      }
      
      if (licensePlate) {
        const response = await fetch(apiUrl(`/public/reservations/by-license?license_plate=${encodeURIComponent(licensePlate)}`));
        const payload = await response.json();
        if (response.ok) {
          if (payload.reservations?.length > 0) {
            setUserBookings(payload.reservations);
          }
          if (payload.active_session) {
            setActiveSession(payload.active_session);
          }
        }
      }
    } catch {}
  };

  const refreshData = async () => {
    await Promise.all([loadPortal(), loadLiveSlots(), loadAvailability(), loadIncidents(), loadUserBookings()]);
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zones = useMemo(() => {
    const slotStates = availability.slot_states || [];
    const zoneRates = getZoneRates(data.zone_pricing, data.zone_duration);
    return zoneRates.map(rate => {
      const zoneSlots = slotStates.filter(s => s.zone === rate.zone);
      const available = zoneSlots.filter(s => s.state === 'available').length;
      const total = zoneSlots.length;
      return {
        ...rate,
        available,
        total,
        occupancyPercent: total > 0 ? Math.round(((total - available) / total) * 100) : 0,
      };
    });
  }, [availability.slot_states, data.zone_pricing, data.zone_duration]);

  const totalAvailable = zones.reduce((sum, z) => sum + z.available, 0);
  const totalSlots = zones.reduce((sum, z) => sum + z.total, 0);
  const overallOccupancy = totalSlots > 0 ? Math.round(((totalSlots - totalAvailable) / totalSlots) * 100) : 0;

  const currentZone = zones.find(z => z.zone === selectedZone);
  const availableSlotChoices = (availability.available_slots || []).filter(slot => slot.zone === selectedZone);

  const prepareReservationPayment = async (confirmationCode, successText) => {
    if (!confirmationCode) return null;
    setBusyKey('payment');
    try {
      const response = await fetch(apiUrl(`/public/payments/reservations/${encodeURIComponent(confirmationCode)}`), {
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to open payment QR');
      setLookupPayment(payload.payment || null);
      setPaymentSheet({
        type: 'reservation',
        title: `Reservation ${payload.payment_request?.reservation_code || confirmationCode}`,
        subtitle: 'Scan the QR code to complete payment.',
        ...payload.payment_request,
      });
      if (successText) setMessage('success', successText);
      return payload;
    } catch (error) {
      setMessage('error', error.message || 'Failed to open payment');
    } finally {
      setBusyKey('');
    }
  };

  const handleLookup = async (event) => {
    event.preventDefault();
    if (!lookupQuery.trim()) return;
    setBusyKey('lookup');
    setMessage('', '');
    try {
      if (lookupMode === 'license_plate') {
        const response = await fetch(apiUrl(`/public/reservations/by-license?license_plate=${encodeURIComponent(lookupQuery.toUpperCase())}`));
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Vehicle not found');
        
        if (payload.active_session) {
          setActiveSession(payload.active_session);
          setLookupResult(payload.reservations?.[0] || { license_plate: lookupQuery.toUpperCase(), status: 'parking' });
          setMessage('success', 'Active parking session found.');
        } else if (payload.reservations?.length > 0) {
          setLookupResult(payload.reservations[0] || null);
          setMessage('success', 'Booking found.');
        } else {
          throw new Error('No active session or booking found for this license plate');
        }
      } else {
        const query = new URLSearchParams();
        query.set(lookupMode, lookupQuery.trim().toUpperCase());
        const response = await fetch(apiUrl(`/public/reservations/lookup?${query.toString()}`));
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Booking not found');
        setLookupResult(payload.reservation || null);
        setLookupPayment(payload.payment || null);
        setMessage('success', 'Booking found.');
      }
    } catch (error) {
      setLookupResult(null);
      setLookupPayment(null);
      setMessage('error', error.message || 'Vehicle not found');
    } finally {
      setBusyKey('');
    }
  };

  const handleCheckout = async () => {
    if (!lookupResult?.confirmation_code) return;
    setBusyKey('checkout');
    setMessage('', '');
    try {
      const response = await fetch(apiUrl(`/public/reservations/${encodeURIComponent(lookupResult.confirmation_code)}/checkout`), {
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to release reservation');
      setLookupResult(payload.reservation || null);
      setLookupPayment(null);
      setPaymentSheet(null);
      setReservationResult(null);
      setMessage('success', `${isReservationInUse(lookupResult) ? 'Parking session released' : 'Reservation cancelled'} for ${payload.reservation?.confirmation_code || lookupResult.confirmation_code}.`);
      await refreshData();
    } catch (error) {
      setMessage('error', error.message || 'Failed to release reservation');
    } finally {
      setBusyKey('');
    }
  };

  const handleReserve = async (event) => {
    event.preventDefault();
    if (!selectedSlot) {
      setMessage('error', 'Please select a parking slot first');
      return;
    }
    if (!reservationForm.full_name.trim()) {
      setMessage('error', 'Please enter your full name');
      return;
    }
    if (!reservationForm.license_plate.trim()) {
      setMessage('error', 'Please enter your license plate');
      return;
    }
    setBusyKey('reserve');
    setMessage('', '');
    try {
      const payloadBody = {
        full_name: reservationForm.full_name.trim(),
        email: reservationForm.email.trim(),
        phone: user?.phone || reservationForm.phone,
        license_plate: reservationForm.license_plate.toUpperCase(),
        slot_id: selectedSlot,
        zone: selectedZone,
        allow_waitlist: true,
        fallback_action: 'waitlist',
      };
      const response = await fetch(apiUrl('/public/reservations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadBody),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to reserve spot');
      if (payload.reservation) {
        setReservationResult(payload.reservation);
        setLookupResult(payload.reservation);
        setLookupPayment(null);
        setReservationForm({ ...emptyReservationForm, payment_method: 'cash' });
        setUserBookings(prev => [payload.reservation, ...prev]);
        await refreshData();
        
        if (reservationForm.payment_method === 'cash') {
          setMessage('success', `Reservation ${payload.reservation.confirmation_code} confirmed. Pay ¥${currentZone?.[selectedDuration] || 0} cash at gate.`);
          setReservationResult({ ...payload.reservation, show_cash_code: true });
        } else {
          setMessage('success', `Reservation ${payload.reservation.confirmation_code} confirmed.`);
        }
        
        setTimeout(() => onTabChange('bookings'), 1500);
      } else {
        setReservationResult(payload.waitlist || null);
        setMessage('success', payload.message || 'Added to waitlist.');
        await refreshData();
      }
    } catch (error) {
      setMessage('error', error.message || 'Failed to reserve spot');
    } finally {
      setBusyKey('');
    }
  };

  const handlePassCheckout = async (event) => {
    event.preventDefault();
    if (!passForm.plan_id) return;
    setBusyKey('pass');
    setMessage('', '');
    try {
      const response = await fetch(apiUrl('/public/monthly-passes/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...passForm,
          license_plate: passForm.license_plate.toUpperCase(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to prepare monthly pass');
      setPaymentSheet({
        type: 'monthly_pass',
        title: payload.pass?.plan_name || 'Monthly Pass',
        subtitle: 'Use the same QR flow to activate your recurring parking access.',
        ...payload.payment_request,
      });
      setMessage('success', `Monthly pass checkout started.`);
      setPassForm((prev) => ({ ...emptyPassForm, plan_id: prev.plan_id }));
    } catch (error) {
      setMessage('error', error.message || 'Failed to prepare monthly pass');
    } finally {
      setBusyKey('');
    }
  };

  const handleIncidentSubmit = async (event) => {
    event.preventDefault();
    if (!incidentForm.title.trim()) {
      setMessage('error', 'Issue title is required.');
      return;
    }
    setBusyKey('incident');
    setMessage('', '');
    try {
      const response = await fetch(apiUrl('/public/incidents'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...incidentForm,
          lot_name: 'Main Lot',
          reporter_name: user?.phone || incidentForm.reporter_name || 'Guest',
          slot_id: incidentForm.slot_id || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Failed to report issue');
      setIncidentForm({ ...emptyIncidentForm, reporter_name: user?.phone || '' });
      setMessage('success', 'Issue reported successfully.');
      await loadIncidents();
    } catch (error) {
      setMessage('error', error.message || 'Failed to report issue');
    } finally {
      setBusyKey('');
    }
  };

  const renderDashboard = () => (
    <div className="mobile-page mobile-dashboard">
      <div className="mobile-header">
        <div className="mobile-header-copy">
          <h1 className="mobile-title">SmartParking</h1>
        </div>
        <button className="mobile-logout-btn" onClick={onLogout}>Logout</button>
      </div>

      <div className="mobile-content">
        {user && (
          <div className="mobile-user-welcome">
            Welcome, {user.full_name || user.phone}
          </div>
        )}

        <div className="mobile-occupancy-card">
          <div className="mobile-occupancy-info">
            <p className="mobile-occupancy-label">Overall Occupancy</p>
            <div className="mobile-occupancy-value">
              <span className="mobile-occupancy-percent">{overallOccupancy}%</span>
              <span className="mobile-occupancy-unit">Full</span>
            </div>
            <p className="mobile-occupancy-detail">{totalAvailable} of {totalSlots} spaces available</p>
          </div>
          <div className="mobile-occupancy-ring">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#E5E7EB" strokeWidth="8" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="#00D9D9" strokeWidth="8"
                strokeDasharray={`${(overallOccupancy / 100) * 282.7} 282.7`}
                strokeDashoffset="0"
                transform="rotate(-90 50 50)"
              />
            </svg>
            <span className="mobile-occupancy-ring-text">{overallOccupancy}%</span>
          </div>
        </div>

        <div className="mobile-quick-stats">
          <div className="mobile-quick-stat">
            <span className="mobile-quick-stat-value">{totalAvailable}</span>
            <span className="mobile-quick-stat-label">Available</span>
          </div>
          <div className="mobile-quick-stat">
            <span className="mobile-quick-stat-value">{liveSlots.occupied || 0}</span>
            <span className="mobile-quick-stat-label">Occupied</span>
          </div>
          <div className="mobile-quick-stat">
            <span className="mobile-quick-stat-value">{liveSlots.reserved || 0}</span>
            <span className="mobile-quick-stat-label">Reserved</span>
          </div>
        </div>

        <div className="mobile-zones">
          <h2 className="mobile-section-title">Parking Zones</h2>
          <div className="mobile-zone-tabs">
            {zones.map(zone => (
              <button
                key={zone.zone}
                className={`mobile-zone-tab ${selectedZone === zone.zone ? 'active' : ''}`}
                onClick={() => setSelectedZone(zone.zone)}
              >
                Zone {zone.zone}
              </button>
            ))}
          </div>
          {currentZone && (
            <div className="mobile-zone-card">
              <div className="mobile-zone-header">
                <div>
                  <h3 className="mobile-zone-name">{currentZone.name}</h3>
                  <p className="mobile-zone-label">{currentZone.label}</p>
                </div>
                <span className="mobile-zone-badge">{currentZone.occupancyPercent}% Full</span>
              </div>
              <div className="mobile-zone-progress">
                <div className="mobile-zone-progress-bar">
                  <div className="mobile-zone-progress-fill" style={{ width: `${currentZone.occupancyPercent}%` }} />
                </div>
                <span className="mobile-zone-progress-text">{currentZone.available} Available / {currentZone.total} Total</span>
              </div>
              <div className="mobile-zone-pricing">
                <div className="mobile-zone-price">
                  <span className="mobile-zone-price-label">Hourly</span>
                  <span className="mobile-zone-price-value">¥{currentZone.hourly}</span>
                </div>
                <div className="mobile-zone-price">
                  <span className="mobile-zone-price-label">Daily</span>
                  <span className="mobile-zone-price-value">¥{currentZone.daily}</span>
                </div>
                <div className="mobile-zone-price">
                  <span className="mobile-zone-price-label">Monthly</span>
                  <span className="mobile-zone-price-value">¥{currentZone.monthly}</span>
                </div>
              </div>
              <button className="mobile-primary-btn" onClick={() => onTabChange('reserve')}>
                Reserve Now
              </button>
            </div>
          )}
        </div>

        <div className="mobile-quick-actions">
          <button className="mobile-secondary-btn" onClick={() => onTabChange('find')}>
            <Search size={16} />
            <span>Find Vehicle</span>
          </button>
          <button className="mobile-secondary-btn" onClick={() => onTabChange('bookings')}>
            <Calendar size={16} />
            <span>My Bookings</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderBookings = () => (
    <div className="mobile-page mobile-dashboard">
      <div className="mobile-header">
        <button className="mobile-back-btn" onClick={() => onTabChange('dashboard')}>←</button>
        <div className="mobile-header-copy">
          <h1 className="mobile-title">My Bookings</h1>
          <p className="mobile-subtitle">Your reservations</p>
        </div>
      </div>

      <div className="mobile-content">
        {activeSession && (
          <div className="mobile-incident-card" style={{ borderColor: '#00D9D9', background: 'rgba(0,217,217,0.1)' }}>
            <div className="mobile-incident-header">
              <strong style={{ color: '#00D9D9' }}>Active Parking Session</strong>
              <span className="mobile-incident-status resolved">In Progress</span>
            </div>
            <div style={{ display: 'grid', gap: '8px', fontSize: '13px', marginTop: '12px' }}>
              <div><span>License Plate:</span> <strong style={{ color: '#fff' }}>{activeSession.license_plate}</strong></div>
              <div><span>Slot:</span> <strong style={{ color: '#fff' }}>{activeSession.slot_id}</strong></div>
              <div><span>Zone:</span> <strong style={{ color: '#fff' }}>{activeSession.zone}</strong></div>
              <div><span>Entry Time:</span> <strong style={{ color: '#fff' }}>{formatDateTime(activeSession.entry_time)}</strong></div>
              <div><span>Duration:</span> <strong style={{ color: '#fff' }}>{activeSession.duration_minutes} minutes</strong></div>
              <div><span>Hourly Rate:</span> <strong style={{ color: '#fff' }}>¥{activeSession.hourly_rate}/hour</strong></div>
              <div style={{ fontSize: '18px', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginTop: '8px' }}>
                <span>Amount Due:</span> <strong style={{ color: '#00D9D9', fontSize: '24px' }}>¥{activeSession.amount_due}</strong>
              </div>
              {activeSession.amount_due > 0 && (
                <button
                  className="mobile-primary-btn mobile-full-width"
                  style={{ marginTop: '12px' }}
                  onClick={() => {
                    setLookupMode('license_plate');
                    setLookupQuery(activeSession.license_plate);
                    onTabChange('find');
                  }}
                >
                  Pay Now
                </button>
              )}
            </div>
          </div>
        )}

        {userBookings.length === 0 && !activeSession ? (
          <div className="mobile-empty-state">
            <Calendar size={32} />
            <p>No Bookings Yet</p>
            <p className="mobile-empty-hint">You have not made any reservations.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '12px', marginTop: activeSession ? '16px' : '0' }}>
            {userBookings.map(booking => (
              <div key={booking.id} className="mobile-incident-card" style={booking.status === 'expired' ? { opacity: 0.6, borderColor: '#666' } : booking.status === 'in_use' ? { borderColor: '#22c55e' } : {}}>
                <div className="mobile-incident-header">
                  <strong>{booking.confirmation_code}</strong>
                  <span className={`mobile-incident-status ${booking.status === 'in_use' ? 'investigating' : booking.status === 'expired' ? 'resolved' : booking.payment_status === 'paid' ? 'resolved' : 'open'}`}>
                    {booking.status === 'in_use' ? 'In Use' : booking.status === 'expired' ? 'Expired' : booking.status === 'completed' ? 'Completed' : booking.payment_status === 'paid' ? 'Paid' : 'Pending'}
                  </span>
                </div>
                <div className="mobile-booking-details">
                  <div><span>Slot:</span> <strong>{booking.slot_id || 'Auto'}</strong></div>
                  <div><span>Zone:</span> <strong>{booking.zone || 'A'}</strong></div>
                  <div><span>Plate:</span> <strong>{booking.license_plate || '-'}</strong></div>
                  <div><span>Status:</span> <strong className={booking.status === 'expired' ? 'expired' : ''} style={{ textTransform: 'capitalize' }}>{booking.status}</strong></div>
                  {booking.entry_time && (
                    <div><span>Entry:</span> <strong>{formatDateTime(booking.entry_time)}</strong></div>
                  )}
                  {booking.time_spent_minutes !== null && booking.time_spent_minutes !== undefined && (
                    <div><span>Time Spent:</span> <strong style={{ color: booking.overstay_minutes > 0 ? '#ef4444' : '#22c55e' }}>{booking.time_spent_minutes} min</strong></div>
                  )}
                  {!booking.entry_time && (
                    <div><span>Ends:</span> <strong>{formatDateTime(booking.end_time)}</strong></div>
                  )}
                  {booking.overstay_minutes > 0 && (
                    <div style={{ background: 'rgba(239,68,68,0.1)', padding: '8px 12px', borderRadius: '8px', marginTop: '8px' }}>
                      <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: '600' }}>Overstay: {booking.overstay_minutes} min</div>
                      <div style={{ color: '#ef4444', fontSize: '12px' }}>Additional charge: ¥{booking.overstay_amount?.toFixed(2) || '0.00'}</div>
                    </div>
                  )}
                </div>
                {reservationQrValue(booking) && booking.status !== 'expired' && booking.status !== 'completed' && (
                  <div className="mobile-reservation-qr-card">
                    <div className="mobile-reservation-qr-label">Reservation QR - Show to Cashier</div>
                    <QRCodeImage
                      data={reservationQrValue(booking)}
                      alt="QR Code"
                      size={148}
                      className="mobile-reservation-qr-image"
                      style={{ width: '148px', height: '148px' }}
                    />
                    <div className="mobile-reservation-qr-code">
                      {booking.confirmation_code}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderReserve = () => (
    <div className="mobile-page mobile-reserve">
      <div className="mobile-header">
        <button className="mobile-back-btn" onClick={() => onTabChange('dashboard')}>←</button>
        <div className="mobile-header-copy">
          <h1 className="mobile-title">Reserve a Spot</h1>
          <p className="mobile-subtitle">Select a parking space</p>
        </div>
      </div>

      <div className="mobile-content">
        <div className="mobile-zone-select">
          <h2 className="mobile-section-title">SELECT ZONE</h2>
          <div className="mobile-zone-grid">
            {zones.map(zone => (
              <button
                key={zone.zone}
                className={`mobile-zone-select-card ${selectedZone === zone.zone ? 'active' : ''}`}
                onClick={() => { setSelectedZone(zone.zone); setSelectedSlot(null); }}
              >
                <span className="mobile-zone-select-name">Zone {zone.zone}</span>
                <span className="mobile-zone-select-label">{zone.label}</span>
                <span className="mobile-zone-select-avail">{zone.available}/{zone.total} Free</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mobile-parking-grid">
          <h2 className="mobile-section-title">PARKING LAYOUT</h2>
          <div className="mobile-parking-legend">
            <span><i className="mobile-legend-available" /> Available</span>
            <span><i className="mobile-legend-occupied" /> Occupied</span>
          </div>
          <div className="mobile-parking-slots">
            {availableSlotChoices.length > 0 ? (
              availableSlotChoices.slice(0, 20).map((slot, idx) => (
                <button
                  key={slot.slot_id}
                  className={`mobile-parking-slot ${selectedSlot === slot.slot_id ? 'selected' : ''}`}
                  onClick={() => setSelectedSlot(slot.slot_id)}
                >
                  {idx + 1}
                </button>
              ))
            ) : (
              <div className="mobile-parking-empty">No available slots in this zone</div>
            )}
          </div>
          <p className="mobile-parking-note">Reservation window: 15 minutes • Auto-release on expiry</p>
        </div>

        {selectedSlot && (
          <div className="mobile-duration-select">
            <h2 className="mobile-section-title">DURATION</h2>
            <div className="mobile-duration-grid">
              {[
                { id: 'hourly', label: 'Hourly', price: currentZone?.hourly || 0 },
                { id: 'daily', label: 'Daily', price: currentZone?.daily || 0 },
                { id: 'monthly', label: 'Monthly', price: currentZone?.monthly || 0 },
              ].map(option => (
                <button
                  key={option.id}
                  className={`mobile-duration-card ${selectedDuration === option.id ? 'active' : ''}`}
                  onClick={() => setSelectedDuration(option.id)}
                >
                  <span className="mobile-duration-label">{option.label}</span>
                  <span className="mobile-duration-price">¥{option.price}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedSlot && (
          <div className="mobile-booking-summary">
            <div className="mobile-summary-row">
              <span>Spot</span>
              <span>{selectedSlot}</span>
            </div>
            <div className="mobile-summary-row">
              <span>Duration</span>
              <span className="capitalize">{selectedDuration}</span>
            </div>
            <div className="mobile-summary-total">
              <span>Total</span>
              <span className="mobile-summary-amount">¥{currentZone?.[selectedDuration] || 0}</span>
            </div>
          </div>
        )}

        <div className="mobile-form">
          <input
            type="text"
            placeholder="Full name"
            value={reservationForm.full_name}
            onChange={(e) => setReservationForm((prev) => ({ ...prev, full_name: e.target.value }))}
          />
          <input
            type="text"
            placeholder="License plate"
            value={reservationForm.license_plate}
            onChange={(e) => setReservationForm((prev) => ({ ...prev, license_plate: e.target.value.toUpperCase() }))}
          />
          <div className="mobile-payment-options">
            <span className="mobile-payment-label">Payment Method</span>
            <div className="mobile-payment-buttons">
              <button
                type="button"
                className={`mobile-payment-btn ${reservationForm.payment_method === 'cash' ? 'active' : ''}`}
                onClick={() => setReservationForm((prev) => ({ ...prev, payment_method: 'cash' }))}
              >
                <CreditCard size={16} />
                Cash at Gate
              </button>
              <button
                type="button"
                className={`mobile-payment-btn ${reservationForm.payment_method === 'alipay' ? 'active' : ''}`}
                onClick={() => setReservationForm((prev) => ({ ...prev, payment_method: 'alipay' }))}
              >
                <CreditCard size={16} />
                Payment
              </button>
            </div>
          </div>
          <button
            className="mobile-primary-btn mobile-full-width"
            disabled={!selectedSlot || busyKey === 'reserve'}
            onClick={handleReserve}
          >
            {busyKey === 'reserve' ? 'Reserving...' : 'Confirm'}
          </button>
        </div>


      </div>
    </div>
  );

  const renderFindVehicle = () => (
    <div className="mobile-page mobile-find">
      <div className="mobile-header">
        <button className="mobile-back-btn" onClick={() => onTabChange('dashboard')}>←</button>
        <div className="mobile-header-copy">
          <h1 className="mobile-title">Find My Vehicle</h1>
          <p className="mobile-subtitle">Search for your reservation</p>
        </div>
      </div>

      <div className="mobile-content">
        <div className="mobile-search-section">
          <h2 className="mobile-section-title">SEARCH BY</h2>
          <div className="mobile-toggle-row">
            <button
              className={`mobile-toggle ${lookupMode === 'license_plate' ? 'active' : ''}`}
              onClick={() => setLookupMode('license_plate')}
            >
              License Plate
            </button>
            <button
              className={`mobile-toggle ${lookupMode === 'confirmation_code' ? 'active' : ''}`}
              onClick={() => setLookupMode('confirmation_code')}
            >
              Confirmation Code
            </button>
          </div>
          <div className="mobile-search-input">
            <input
              type="text"
              value={lookupQuery}
              placeholder={lookupMode === 'license_plate' ? 'Enter plate number' : 'Enter confirmation code'}
              onChange={(e) => setLookupQuery(e.target.value.toUpperCase())}
            />
            <button className="mobile-primary-btn" onClick={handleLookup} disabled={busyKey === 'lookup'}>
              {busyKey === 'lookup' ? 'Finding...' : 'Search'}
            </button>
          </div>
        </div>

        {activeSession && (
          <div className="mobile-vehicle-result" style={{ borderColor: '#00D9D9' }}>
            <div className="mobile-vehicle-header">
              <p className="mobile-vehicle-plate">{activeSession.license_plate}</p>
              <span className="mobile-vehicle-status paid">Currently Parked</span>
            </div>
            <div className="mobile-vehicle-details">
              <div><span>Slot</span><strong>{activeSession.slot_id}</strong></div>
              <div><span>Zone</span><strong>{activeSession.zone}</strong></div>
              <div><span>Payment</span><strong>{activeSession.payment_method === 'alipay' ? 'Payment' : 'Cash at Gate'}</strong></div>
              <div><span>Entry</span><strong>{formatDateTime(activeSession.entry_time)}</strong></div>
              <div><span>Duration</span><strong>{activeSession.duration_minutes} min</strong></div>
              <div><span>Rate</span><strong>¥{activeSession.hourly_rate}/hr</strong></div>
            </div>
            <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginTop: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Amount Due</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#00D9D9' }}>¥{activeSession.amount_due}</div>
            </div>
            {activeSession.payment_method === 'cash' ? (
              <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(0,217,217,0.1)', border: '1px solid rgba(0,217,217,0.3)', borderRadius: '10px', textAlign: 'center' }}>
                <div className="mobile-reservation-qr-label">Reservation QR - Show to Cashier</div>
              </div>
            ) : (
              <div className="mobile-vehicle-actions">
                {data.payments.enabled && (
                  <button
                    className="mobile-primary-btn"
                    onClick={() => prepareReservationPayment(activeSession.confirmation_code || 'SESSION-' + activeSession.session_id, 'Payment QR opened.')}
                    disabled={busyKey === 'payment'}
                  >
                    Pay with Payment
                  </button>
                )}
              </div>
            )}
            <div className="mobile-vehicle-actions">
              <button className="mobile-secondary-btn" onClick={handleCheckout} disabled={busyKey === 'checkout'}>
                Release Spot
              </button>
            </div>
          </div>
        )}

        {lookupResult && !activeSession && (
          <div className="mobile-vehicle-result">
            <div className="mobile-vehicle-header">
              <p className="mobile-vehicle-plate">{lookupResult.confirmation_code || lookupResult.license_plate}</p>
              <span className={`mobile-vehicle-status ${lookupStatusTone(lookupResult)}`}>
                {lookupStatusLabel(lookupResult)}
              </span>
            </div>
            <div className="mobile-vehicle-details">
              <div><span>Slot</span><strong>{lookupResult.slot_id || 'Auto assigned'}</strong></div>
              <div><span>Zone</span><strong>{lookupResult.zone || 'A'}</strong></div>
              <div><span>Payment</span><strong>{lookupResult.payment_method === 'alipay' ? 'Payment' : 'Cash at Gate'}</strong></div>
              <div><span>Reservation</span><strong>{lookupStatusLabel(lookupResult)}</strong></div>
              <div><span>Payment Status</span><strong>{lookupResult.payment_status || 'pending'}</strong></div>
              <div><span>Start</span><strong>{formatDateTime(lookupResult.start_time)}</strong></div>
              <div><span>Ends</span><strong>{formatDateTime(lookupResult.end_time)}</strong></div>
            </div>
            {!['cancelled', 'expired', 'completed'].includes(String(lookupResult.status || '').toLowerCase()) && (
              <div className="mobile-vehicle-actions">
                {lookupResult.payment_status !== 'paid' && lookupResult.payment_method === 'alipay' && data.payments.enabled && (
                  <button
                    className="mobile-primary-btn"
                    onClick={() => prepareReservationPayment(lookupResult.confirmation_code, 'Payment QR opened.')}
                    disabled={busyKey === 'payment'}
                  >
                    Pay with Payment
                  </button>
                )}
                {lookupResult.payment_status !== 'paid' && lookupResult.payment_method === 'cash' && (
                  <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(0,217,217,0.1)', border: '1px solid rgba(0,217,217,0.3)', borderRadius: '10px', marginBottom: '12px' }}>
                    <div className="mobile-reservation-qr-label">Reservation QR - Show to Cashier</div>
                  </div>
                )}
                <button className="mobile-secondary-btn" onClick={handleCheckout} disabled={busyKey === 'checkout'}>
                  {isReservationInUse(lookupResult) ? 'Release Spot' : 'Cancel Reservation'}
                </button>
              </div>
            )}
          </div>
        )}

        {!lookupResult && lookupQuery && (
          <div className="mobile-empty-state">
            <Search size={32} />
            <p>Vehicle Not Found</p>
            <p className="mobile-empty-hint">Please check your license plate or confirmation code.</p>
          </div>
        )}

        {!lookupResult && !lookupQuery && (
          <div className="mobile-help-card">
            <p className="mobile-help-title">Need Help?</p>
            <ul>
              <li>• Enter your license plate (e.g., ABC123)</li>
              <li>• Or use your confirmation code</li>
              <li>• View your parking location</li>
              <li>• Pay outstanding fees if needed</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );

  const renderReport = () => (
    <div className="mobile-page mobile-report">
      <div className="mobile-header">
        <button className="mobile-back-btn" onClick={() => onTabChange('dashboard')}>←</button>
        <div className="mobile-header-copy">
          <h1 className="mobile-title">Report Issue</h1>
          <p className="mobile-subtitle">Submit incident or problem</p>
        </div>
      </div>

      <div className="mobile-content">
        <div className="mobile-issue-types">
          <h2 className="mobile-section-title">ISSUE TYPE</h2>
          <div className="mobile-issue-grid">
            {issueTypes.map(type => (
              <button
                key={type.id}
                className={`mobile-issue-card ${incidentForm.category === type.id ? 'active' : ''}`}
                onClick={() => setIncidentForm((prev) => ({ ...prev, category: type.id }))}
              >
                {type.icon && <type.icon size={20} className="mobile-issue-icon" />}
                <span className="mobile-issue-label">{type.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mobile-form">
          <h2 className="mobile-section-title">MOBILE PHONE</h2>
          <input
            type="tel"
            placeholder="Your phone number"
            value={incidentForm.reporter_name}
            readOnly={Boolean(user?.phone)}
            onChange={(e) => setIncidentForm((prev) => ({ ...prev, reporter_name: e.target.value }))}
          />
          <h2 className="mobile-section-title">TITLE</h2>
          <input
            type="text"
            placeholder="Brief title of the issue"
            value={incidentForm.title}
            onChange={(e) => setIncidentForm((prev) => ({ ...prev, title: e.target.value }))}
          />
          <h2 className="mobile-section-title">DESCRIPTION</h2>
          <textarea
            placeholder="Describe the issue in detail..."
            rows={4}
            value={incidentForm.description}
            onChange={(e) => setIncidentForm((prev) => ({ ...prev, description: e.target.value }))}
          />
          <label className="mobile-upload">
            <Image size={16} />
            Add image (optional)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onloadend = () => {
                  setIncidentForm((prev) => ({ ...prev, image_data: reader.result || '' }));
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {incidentForm.image_data && (
            <div style={{ marginTop: '10px', position: 'relative' }}>
              <img 
                src={incidentForm.image_data} 
                alt="Preview" 
                style={{ width: '100%', borderRadius: '8px', border: '2px solid #3b82f6' }}
              />
              <button
                type="button"
                onClick={() => setIncidentForm((prev) => ({ ...prev, image_data: '' }))}
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <button
            className="mobile-primary-btn mobile-full-width"
            disabled={busyKey === 'incident' || !incidentForm.title.trim() || !incidentForm.description.trim()}
            onClick={handleIncidentSubmit}
          >
            {busyKey === 'incident' ? 'Sending...' : 'Submit Report'}
          </button>
        </div>

        <div className="mobile-incidents">
          <h2 className="mobile-section-title">REPORT HISTORY</h2>
          {incidents.length === 0 ? (
            <div className="mobile-empty-state">
              <AlertTriangle size={32} />
              <p>No Reports Yet</p>
              <p className="mobile-empty-hint">You have not submitted any reports.</p>
            </div>
          ) : (
            incidents.slice(0, 5).map(incident => (
              <div key={incident.id} className="mobile-incident-card">
                <div className="mobile-incident-header">
                  <strong>{incident.title}</strong>
                  <span className={`mobile-incident-status ${incident.status}`}>
                    {incident.status}
                  </span>
                </div>
                {incident.reporter_name && (
                  <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                    {incident.reporter_name}
                  </p>
                )}
                <p className="mobile-incident-desc">{incident.description}</p>
                {incident.image_path && (
                  <img 
                    src={apiUrl(incident.image_path)} 
                    alt="Incident" 
                    style={{ width: '100%', borderRadius: '8px', marginTop: '8px' }}
                  />
                )}
                <div className="mobile-incident-meta">
                  <span>{incident.category}</span>
                  <span>{incident.severity}</span>
                  <span>{formatDateTime(incident.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderPasses = () => (
    <div className="mobile-page mobile-passes">
      <div className="mobile-header">
        <button className="mobile-back-btn" onClick={() => onTabChange('dashboard')}>←</button>
        <div className="mobile-header-copy">
          <h1 className="mobile-title">Monthly Passes</h1>
          <p className="mobile-subtitle">Recurring parking for frequent drivers</p>
        </div>
      </div>

      <div className="mobile-content">
        <div className="mobile-pass-grid">
          {passCatalog.map(plan => (
            <button
              key={plan.id}
              className={`mobile-pass-card ${passForm.plan_id === plan.id ? 'selected' : ''}`}
              onClick={() => setPassForm((prev) => ({ ...prev, plan_id: plan.id }))}
            >
              <span className="mobile-pass-name">{plan.name}</span>
              <strong className="mobile-pass-price">¥{formatMoney(plan.amount)}/mo</strong>
              <small>{plan.description}</small>
            </button>
          ))}
        </div>

        <div className="mobile-form">
          <input
            type="text"
            placeholder="Full name"
            value={passForm.full_name}
            onChange={(e) => setPassForm((prev) => ({ ...prev, full_name: e.target.value }))}
          />
          <input
            type="text"
            placeholder="License plate"
            value={passForm.license_plate}
            onChange={(e) => setPassForm((prev) => ({ ...prev, license_plate: e.target.value.toUpperCase() }))}
          />
          <button
            className="mobile-primary-btn mobile-full-width"
            disabled={!passForm.plan_id || busyKey === 'pass'}
            onClick={handlePassCheckout}
          >
            {busyKey === 'pass' ? 'Preparing...' : `Pay ¥${formatMoney(passCatalog.find(p => p.id === passForm.plan_id)?.amount || 0)} via Payment`}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mobile-portal">
      {flash.text && (
        <div className={`mobile-flash ${flash.tone}`}>
          <span>{flash.text}</span>
        </div>
      )}

      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'bookings' && renderBookings()}
      {activeTab === 'reserve' && renderReserve()}
      {activeTab === 'find' && renderFindVehicle()}
      {activeTab === 'passes' && renderPasses()}
      {activeTab === 'report' && renderReport()}

      {paymentSheet && (
        <div className="mobile-payment-overlay" onClick={() => setPaymentSheet(null)}>
          <div className="mobile-payment-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-payment-header">
              <h3>{paymentSheet.type === 'monthly_pass' ? 'Monthly Pass Payment' : 'Reservation Payment'}</h3>
              <button onClick={() => setPaymentSheet(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={24} /></button>
            </div>
            <div className="mobile-payment-qr">
              {looksLikeImageSource(paymentSheet.qr_code) ? (
                <img src={paymentSheet.qr_code} alt="Payment QR" />
              ) : (
                <div className="mobile-payment-fallback">{paymentSheet.qr_code || 'QR unavailable'}</div>
              )}
            </div>
            <div className="mobile-payment-meta">
              <div><span>Amount</span><strong>¥{formatMoney(paymentSheet.amount)}</strong></div>
              <div><span>Status</span><strong>{paymentSheet.status || 'pending'}</strong></div>
            </div>
            <p className="mobile-payment-instructions">{paymentSheet.instructions || 'Scan the code with Payment to complete payment.'}</p>
          </div>
        </div>
      )}

      <div className="mobile-bottom-nav">
        <button className={`mobile-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => onTabChange('dashboard')}>
          <Home size={20} className="mobile-nav-icon" />
          <span>Home</span>
        </button>
        <button className={`mobile-nav-item ${activeTab === 'bookings' ? 'active' : ''}`} onClick={() => onTabChange('bookings')}>
          <Calendar size={20} className="mobile-nav-icon" />
          <span>Bookings</span>
        </button>
        <button className={`mobile-nav-item ${activeTab === 'reserve' ? 'active' : ''}`} onClick={() => onTabChange('reserve')}>
          <MapPin size={20} className="mobile-nav-icon" />
          <span>Reserve</span>
        </button>
        <button className={`mobile-nav-item ${activeTab === 'find' ? 'active' : ''}`} onClick={() => onTabChange('find')}>
          <Search size={20} className="mobile-nav-icon" />
          <span>Find</span>
        </button>
        <button className={`mobile-nav-item ${activeTab === 'report' ? 'active' : ''}`} onClick={() => onTabChange('report')}>
          <AlertTriangle size={20} className="mobile-nav-icon" />
          <span>Report</span>
        </button>
      </div>
    </div>
  );
};

export default MobilePortal;
