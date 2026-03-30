import React, { useState, useEffect } from 'react';
import { apiUrl } from '../../lib/api';
import { authFetch } from '../../lib/auth';

const styles = `
  .sp-page { padding: 24px; max-width: 1400px; margin: 0 auto; }
  .sp-head { margin-bottom: 24px; }
  .sp-page h1 { font-size: 24px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); letter-spacing: -0.02em; }

  .sp-cards { display: grid; grid-template-columns: 1fr; gap: 18px; align-items: start; }
  .sp-card {
    padding: 20px;
    border-radius: 12px;
    position: relative;
    overflow: hidden;
  }
  .sp-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: linear-gradient(180deg, var(--card-accent), transparent); opacity: 0.95; }
  .sp-card-wide { grid-column: span 1; }
  .sp-card-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .sp-card-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.08); }
  .sp-card h2 { font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .sp-card .sp-card-desc { font-size: 12px; color: var(--text-muted); margin-top: 3px; }

  .sp-section { margin-bottom: 22px; }
  .sp-section:last-child { margin-bottom: 0; }
  .sp-section-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }

  .sp-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 12px 0; }
  .sp-row + .sp-row { border-top: 1px solid rgba(255,255,255,0.04); }
  .sp-row-info { flex: 1; min-width: 0; }
  .sp-row-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .sp-row-hint { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

  .sp-input { padding: 9px 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: var(--text-primary); font: 400 13px 'Inter', sans-serif; outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; width: 100%; min-height: 40px; }
  .sp-input:hover { background: rgba(255,255,255,0.05); }
  .sp-input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(52,152,219,0.15); }
  .sp-input::placeholder { color: rgba(255,255,255,0.2); }
  .sp-input-sm { width: 120px; }
  .sp-input-num { font-variant-numeric: tabular-nums; text-align: right; }

  .sp-range-wrap { display: flex; align-items: center; gap: 12px; width: 240px; }
  .sp-range { flex: 1; -webkit-appearance: none; appearance: none; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; outline: none; cursor: pointer; }
  .sp-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: var(--blue); border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); cursor: pointer; transition: transform 0.15s; }
  .sp-range::-webkit-slider-thumb:hover { transform: scale(1.2); }
  .sp-range-val { font-size: 12px; color: var(--text-secondary); min-width: 36px; text-align: right; font-family: 'JetBrains Mono', monospace; }

  .sp-check { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--text-primary); user-select: none; }
  .sp-check input { width: 16px; height: 16px; accent-color: var(--blue); cursor: pointer; }

  .sp-grid { display: grid; gap: 14px; }
  .sp-grid-2 { grid-template-columns: 1fr 1fr; }
  .sp-grid-3 { grid-template-columns: 1fr 1fr 1fr; }

  .sp-field { display: flex; flex-direction: column; gap: 6px; }
  .sp-field label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }

  .sp-actions { display: flex; gap: 10px; margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); }
  .sp-btn { height: 40px; padding: 0 20px; border-radius: 8px; border: none; cursor: pointer; font: 600 13px 'Inter', sans-serif; display: flex; align-items: center; justify-content: center; gap: 6px; transition: filter 0.15s, transform 0.1s, border-color 0.15s; white-space: nowrap; }
  .sp-btn:hover { filter: brightness(1.12); }
  .sp-btn:active { transform: scale(0.97); }
  .sp-btn-primary { background: linear-gradient(135deg, var(--blue), var(--blue-dark)); color: #fff; }
  .sp-btn-secondary { background: rgba(255,255,255,0.06); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.08); }
  .sp-btn-secondary:hover { color: var(--text-primary); }

  .sp-toggle-wrap { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .sp-toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
  .sp-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .sp-toggle-track { position: absolute; inset: 0; background: rgba(255,255,255,0.12); border-radius: 11px; cursor: pointer; transition: background 0.2s; }
  .sp-toggle-track::after { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: rgba(255,255,255,0.6); border-radius: 50%; transition: transform 0.2s ease, background 0.2s; }
  .sp-toggle input:checked + .sp-toggle-track { background: var(--blue); }
  .sp-toggle input:checked + .sp-toggle-track::after { transform: translateX(18px); background: #fff; }

  .sp-zone-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .sp-zone-card { position: relative; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 16px; transition: border-color 0.15s, background 0.15s, transform 0.15s; overflow: hidden; }
  .sp-zone-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--zone-color, rgba(255,255,255,0.2)); }
  .sp-zone-card:hover { border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); transform: translateY(-1px); }
  .sp-zone-header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .sp-zone-badge { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; }
  .sp-zone-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .sp-zone-name small { display: block; font-size: 11px; font-weight: 400; color: var(--text-muted); margin-top: 1px; }

  .sp-nested { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 14px 16px; }
  .sp-nested .sp-row:first-child { padding-top: 0; }
  .sp-nested .sp-row:last-child { padding-bottom: 0; }

  .sp-btns-inline { display: flex; gap: 10px; }
  .sp-btns-inline .sp-btn { height: 36px; padding: 0 14px; font-size: 12px; }

  @media (max-width: 640px) {
    .sp-page { padding: 20px 16px; }
    .sp-head, .sp-row, .sp-actions { flex-direction: column; align-items: stretch; }
    .sp-grid-2, .sp-grid-3, .sp-zone-grid { grid-template-columns: 1fr; }
    .sp-range-wrap { width: 100%; }
    .sp-btn { width: 100%; }
  }
`;

const Toggle = ({ checked, onChange }) => (
  <label className="sp-toggle">
    <input type="checkbox" checked={checked} onChange={onChange} />
    <span className="sp-toggle-track" />
  </label>
);

const Row = ({ name, hint, children }) => (
  <div className="sp-row">
    <div className="sp-row-info">
      <div className="sp-row-name">{name}</div>
      {hint && <div className="sp-row-hint">{hint}</div>}
    </div>
    {children}
  </div>
);

const Card = ({ icon, color, title, desc, children, wide = false }) => (
  <div className={`glass sp-card${wide ? ' sp-card-wide' : ''}`} style={{ '--card-accent': color }}>
    <div className="sp-card-header">
      <div className="sp-card-icon" style={{ background: `${color}18`, color }}>{icon}</div>
      <div>
        <h2>{title}</h2>
        {desc && <div className="sp-card-desc">{desc}</div>}
      </div>
    </div>
    {children}
  </div>
);

const SettingsPage = ({ token }) => {
  const [settings, setSettings] = useState({});

  useEffect(() => { fetchSettings(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSettings = async () => {
    const response = await authFetch('/settings', {}, token);
    const data = await response.json();
    setSettings(data);
  };

  const updateSettings = async (updates) => {
    const newSettings = { ...settings, ...updates };
    const response = await authFetch('/settings', {
      method: 'PUT',
      body: JSON.stringify(newSettings)
    }, token);
    if (response.ok) {
      alert('Settings saved');
      setSettings(newSettings);
    }
  };

  const portalUrl = typeof window !== 'undefined'
    ? (settings.access_portal_url || `${window.location.origin}${window.location.pathname}?portal=access`)
    : (settings.access_portal_url || '');
  const portalQrUrl = portalUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(portalUrl)}` : '';

  const copyPortalUrl = async () => {
    if (!portalUrl || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      alert('Portal link copied');
    } catch {
      alert('Failed to copy portal link');
    }
  };

  const handleExportNow = async () => {
    try {
      const response = await fetch(apiUrl('/export/trigger'), { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(payload.detail || payload.error || 'Export failed');
      }
      alert(payload.filename ? `Export created: ${payload.filename}` : 'Export completed');
    } catch (error) {
      alert(error.message || 'Export failed');
    }
  };

  const s = settings;
  return (
    <>
      <style>{styles}</style>
      <div className="sp-page">
        <div className="sp-head">
          <h1>Settings</h1>
        </div>

        <div className="sp-cards">
        {/* ── Detection ──────────────────────── */}
        <Card icon="◉" color="#3498DB" title="Detection" desc="License plate recognition and camera settings">
          <div className="sp-section">
            <div className="sp-section-label">Camera</div>
            <Row name="License Plate Recognition" hint="Automatically detect plates from video feed">
              <label className="sp-toggle-wrap">
                <Toggle checked={s.lpr_enabled || false} onChange={e => setSettings({ ...s, lpr_enabled: e.target.checked })} />
              </label>
            </Row>
            <Row name="Confidence Threshold" hint="Minimum score to accept a detection">
              <div className="sp-range-wrap">
                <input className="sp-range" type="range" min="0" max="1" step="0.05"
                  value={s.lpr_confidence_threshold || 0.5}
                  onChange={e => setSettings({ ...s, lpr_confidence_threshold: parseFloat(e.target.value) })} />
                <span className="sp-range-val">{(s.lpr_confidence_threshold || 0.5).toFixed(2)}</span>
              </div>
            </Row>
            <Row name="Region Hint" hint="Restrict plate format (e.g. EU, US)">
              <input className="sp-input sp-input-sm" style={{ width: 160 }} type="text"
                value={s.lpr_region_hint || ''} placeholder="Any"
                onChange={e => setSettings({ ...s, lpr_region_hint: e.target.value })} />
            </Row>
          </div>
          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={() => updateSettings({ lpr_enabled: s.lpr_enabled, lpr_confidence_threshold: s.lpr_confidence_threshold, lpr_region_hint: s.lpr_region_hint })}>Save Detection</button>
          </div>
        </Card>

        {/* ── Vehicle & Slots ────────────────── */}
        <Card icon="⬡" color="#F59E0B" title="Vehicle & Slots" desc="Parking rules and violation thresholds">
          <div className="sp-section">
            <div className="sp-section-label">Violations</div>
            <div className="sp-grid sp-grid-2">
              <div className="sp-field">
                <label>Abandoned Threshold (min)</label>
                <input className="sp-input sp-input-num" type="number" value={s.abandoned_threshold_minutes || 120}
                  onChange={e => setSettings({ ...s, abandoned_threshold_minutes: parseInt(e.target.value) })} />
              </div>
              <div className="sp-field">
                <label>Wrong-Way Angle (°)</label>
                <input className="sp-input sp-input-num" type="number" value={s.wrong_way_angle_threshold || 120}
                  onChange={e => setSettings({ ...s, wrong_way_angle_threshold: parseInt(e.target.value) })} />
              </div>
              <div className="sp-field">
                <label>Speed Limit (km/h)</label>
                <input className="sp-input sp-input-num" type="number" value={s.speed_limit_kmh || 10}
                  onChange={e => setSettings({ ...s, speed_limit_kmh: parseFloat(e.target.value) })} />
              </div>
              <div className="sp-field">
                <label>Alert Threshold (km/h)</label>
                <input className="sp-input sp-input-num" type="number" value={s.speed_alert_kmh || 15}
                  onChange={e => setSettings({ ...s, speed_alert_kmh: parseFloat(e.target.value) })} />
              </div>
            </div>
          </div>
          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={() => updateSettings({
              abandoned_threshold_minutes: s.abandoned_threshold_minutes,
              wrong_way_angle_threshold: s.wrong_way_angle_threshold,
              speed_limit_kmh: s.speed_limit_kmh,
              speed_alert_kmh: s.speed_alert_kmh
            })}>Save Vehicle Rules</button>
          </div>
        </Card>

        {/* ── Revenue & Pricing ──────────────── */}
        <Card wide icon="$" color="#2ECC71" title="Revenue & Pricing" desc="Set rates per zone and configure billing rules">
          <div className="sp-section">
            <div className="sp-section-label">General</div>
            <Row name="Enable Pricing" hint="Automatically calculate fees on exit">
              <Toggle checked={s.pricing_enabled || false} onChange={e => setSettings({ ...s, pricing_enabled: e.target.checked })} />
            </Row>
            <Row name="Billing Unit" hint="Calculate rates per minute or per hour">
              <select
                className="sp-input"
                style={{ width: 140, textAlign: 'left', cursor: 'pointer' }}
                value={s.pricing_unit || 'hour'}
                onChange={e => setSettings({ ...s, pricing_unit: e.target.value })}
              >
                <option value="minute">Per Minute</option>
                <option value="hour">Per Hour</option>
              </select>
            </Row>
          </div>

          <div className="sp-section">
            <div className="sp-section-label">Zone Pricing</div>
            <div className="sp-zone-grid">
              {['A', 'B', 'C'].map(zone => {
                const zoneColors = { A: '#3498DB', B: '#E67E22', C: '#9B59B6' };
                const zoneLabels = { A: 'Zone A \u2013 Standard', B: 'Zone B \u2013 Economy', C: 'Zone C \u2013 Premium' };
                const defaults = { A: 2, B: 1, C: 4 };
                const durationDefaults = { A: 30, B: 30, C: 30 };
                return (
                  <div className="sp-zone-card" key={zone} style={{ '--zone-color': zoneColors[zone] }}>
                    <div className="sp-zone-header">
                      <div className="sp-zone-badge" style={{ background: `${zoneColors[zone]}20`, color: zoneColors[zone] }}>{zone}</div>
                      <div className="sp-zone-name">{zoneLabels[zone]}</div>
                    </div>
                    <div className="sp-grid sp-grid-2">
                      <div className="sp-field">
                        <label>Price ({s.pricing_unit === 'minute' ? '$ / block' : '$ / block'})</label>
                        <input className="sp-input sp-input-num" type="number" step={s.pricing_unit === 'minute' ? '0.01' : '0.5'} min="0"
                          value={s.zone_pricing?.[zone] ?? defaults[zone]}
                          onChange={e => setSettings({
                            ...s,
                            zone_pricing: { ...(s.zone_pricing || {}), [zone]: parseFloat(e.target.value) }
                          })} />
                      </div>
                      <div className="sp-field">
                        <label>Duration ({s.pricing_unit === 'minute' ? 'min' : 'hr'})</label>
                        <input className="sp-input sp-input-num" type="number" step={s.pricing_unit === 'minute' ? '1' : '0.5'} min="1"
                          value={s.zone_duration?.[zone] ?? durationDefaults[zone]}
                          onChange={e => setSettings({
                            ...s,
                            zone_duration: { ...(s.zone_duration || {}), [zone]: parseFloat(e.target.value) }
                          })} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="sp-section">
            <div className="sp-section-label">Billing Rules</div>
            <div className="sp-grid sp-grid-2">
              <div className="sp-field">
                <label>Grace Period (min)</label>
                <input className="sp-input sp-input-num" type="number" value={s.grace_period_minutes || 15}
                  onChange={e => setSettings({ ...s, grace_period_minutes: parseInt(e.target.value) })} />
              </div>
              <div className="sp-field">
                <label>Max Daily Charge ($)</label>
                <input className="sp-input sp-input-num" type="number" value={s.max_daily_charge || 20}
                  onChange={e => setSettings({ ...s, max_daily_charge: parseFloat(e.target.value) })} />
              </div>
            </div>
          </div>

          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={() => updateSettings({
              pricing_enabled: s.pricing_enabled,
              pricing_unit: s.pricing_unit,
              zone_pricing: s.zone_pricing,
              zone_duration: s.zone_duration,
              pricing: s.pricing,
              grace_period_minutes: s.grace_period_minutes,
              max_daily_charge: s.max_daily_charge
            })}>Save Pricing</button>
          </div>
        </Card>

        <Card wide icon="⌁" color="#3498DB" title="System Access QR" desc="Create a public QR so users can scan and reserve, check status, pay, and track their booking">
          <div className="sp-section">
            <div className="sp-grid sp-grid-2">
              <div className="sp-field">
                <label>Portal Title</label>
                <input className="sp-input" type="text" value={s.access_portal_title || ''} placeholder="SmartParking Access"
                  onChange={e => setSettings({ ...s, access_portal_title: e.target.value })} />
              </div>
              <div className="sp-field">
                <label>Portal Tagline</label>
                <input className="sp-input" type="text" value={s.access_portal_tagline || ''} placeholder="Reserve, monitor, pay, and follow live parking activity"
                  onChange={e => setSettings({ ...s, access_portal_tagline: e.target.value })} />
              </div>
            </div>
            <div className="sp-field" style={{ marginTop: 14 }}>
              <label>Public Portal URL</label>
              <input className="sp-input" type="text" value={s.access_portal_url || ''} placeholder="Optional override, for example http://10.29.14.9:3000/?portal=access"
                onChange={e => setSettings({ ...s, access_portal_url: e.target.value })} />
            </div>
          </div>

          <div className="sp-section">
            <div className="sp-section-label">QR Preview</div>
            <div className="sp-nested" style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
              <div style={{ display: 'grid', justifyItems: 'center', gap: 10 }}>
                {portalQrUrl ? (
                  <img
                    src={portalQrUrl}
                    alt="System access QR"
                    style={{ width: 200, maxWidth: '100%', aspectRatio: '1 / 1', objectFit: 'contain', borderRadius: 16, background: '#fff', padding: 12 }}
                  />
                ) : (
                  <div style={{ width: 200, aspectRatio: '1 / 1', borderRadius: 16, border: '1px dashed rgba(255,255,255,0.12)', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>
                    No QR yet
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>
                  Scan opens the user portal where customers can reserve a slot, check a reservation by confirmation code, open payment QR, and track booking status on mobile.
                </div>
                <textarea className="sp-input" readOnly rows="3" value={portalUrl} style={{ resize: 'vertical', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                <div className="sp-btns-inline">
                  <button className="sp-btn sp-btn-secondary" onClick={copyPortalUrl}>Copy Link</button>
                  <a className="sp-btn sp-btn-secondary" href={portalUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open Portal</a>
                  <a className="sp-btn sp-btn-secondary" href={portalQrUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open QR</a>
                </div>
              </div>
            </div>
          </div>

          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={() => updateSettings({
              access_portal_title: s.access_portal_title,
              access_portal_tagline: s.access_portal_tagline,
              access_portal_url: s.access_portal_url
            })}>Save Access QR</button>
          </div>
        </Card>

        {/* ── Export ─────────────────────────── */}
        <Card icon="↗" color="#8E44AD" title="Export & Notifications" desc="Data export, email alerts, and cloud storage">
          <div className="sp-section">
            <div className="sp-section-label">Data Export</div>
            <Row name="Auto Export" hint="Periodically export parking data">
              <Toggle checked={s.export_enabled || false} onChange={e => setSettings({ ...s, export_enabled: e.target.checked })} />
            </Row>
          </div>

          <div className="sp-section">
            <div className="sp-section-label">Email</div>
            <div className="sp-nested">
              <Row name="Email Notifications" hint="Receive reports via email">
                <Toggle checked={s.email_enabled || false} onChange={e => setSettings({ ...s, email_enabled: e.target.checked })} />
              </Row>
              <Row name="Recipient Address">
                <input className="sp-input" style={{ width: 200 }} type="email" value={s.email_recipient || ''} placeholder="admin@example.com"
                  onChange={e => setSettings({ ...s, email_recipient: e.target.value })} />
              </Row>
            </div>
          </div>

          <div className="sp-section">
            <div className="sp-section-label">Amazon S3</div>
            <div className="sp-nested">
              <Row name="S3 Storage" hint="Upload exports to a bucket">
                <Toggle checked={s.s3_enabled || false} onChange={e => setSettings({ ...s, s3_enabled: e.target.checked })} />
              </Row>
              <Row name="Bucket Name">
                <input className="sp-input" style={{ width: 200 }} type="text" value={s.s3_bucket || ''} placeholder="my-parking-bucket"
                  onChange={e => setSettings({ ...s, s3_bucket: e.target.value })} />
              </Row>
            </div>
          </div>

          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={() => updateSettings({
              export_enabled: s.export_enabled,
              email_enabled: s.email_enabled,
              email_recipient: s.email_recipient,
              s3_enabled: s.s3_enabled,
              s3_bucket: s.s3_bucket
            })}>Save Export</button>
            <button className="sp-btn sp-btn-secondary" onClick={handleExportNow}>Export Now</button>
          </div>
        </Card>

        {/* ── Map & Calibration ─────────────── */}
        <Card icon="◎" color="#1ABC9C" title="Map & Calibration" desc="GPS coordinates and pixel mapping for camera view">
          <div className="sp-section">
            <div className="sp-section-label">Location</div>
            <div className="sp-grid sp-grid-2">
              <div className="sp-field">
                <label>Lot Latitude</label>
                <input className="sp-input sp-input-num" type="number" step="0.000001" value={s.lot_lat || 0}
                  onChange={e => setSettings({ ...s, lot_lat: parseFloat(e.target.value) })} />
              </div>
              <div className="sp-field">
                <label>Lot Longitude</label>
                <input className="sp-input sp-input-num" type="number" step="0.000001" value={s.lot_lng || 0}
                  onChange={e => setSettings({ ...s, lot_lng: parseFloat(e.target.value) })} />
              </div>
            </div>
          </div>

          <div className="sp-section">
            <div className="sp-section-label">Calibration</div>
            <Row name="Pixels per Meter" hint="Scale factor between camera and real-world distance">
              <input className="sp-input sp-input-sm sp-input-num" type="number" value={s.pixels_per_meter || 8}
                onChange={e => setSettings({ ...s, pixels_per_meter: parseFloat(e.target.value) })} />
            </Row>
            <div className="sp-grid sp-grid-2" style={{ marginTop: 10 }}>
              <div className="sp-field">
                <label>Entrance Pixel X</label>
                <input className="sp-input sp-input-num" type="number" value={s.entrance_pixel_x || 0}
                  onChange={e => setSettings({ ...s, entrance_pixel_x: parseInt(e.target.value) })} />
              </div>
              <div className="sp-field">
                <label>Entrance Pixel Y</label>
                <input className="sp-input sp-input-num" type="number" value={s.entrance_pixel_y || 0}
                  onChange={e => setSettings({ ...s, entrance_pixel_y: parseInt(e.target.value) })} />
              </div>
            </div>
          </div>

          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={() => updateSettings({
              lot_lat: s.lot_lat,
              lot_lng: s.lot_lng,
              pixels_per_meter: s.pixels_per_meter,
              entrance_pixel_x: s.entrance_pixel_x,
              entrance_pixel_y: s.entrance_pixel_y
            })}>Save Calibration</button>
          </div>
        </Card>
        </div>
      </div>
    </>
  );
};

const looksLikeImageSource = (value) => typeof value === 'string' && /^(https?:\/\/|data:image\/|\/)/i.test(value.trim());

export default SettingsPage;
