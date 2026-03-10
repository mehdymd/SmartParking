import React, { useState, useEffect } from 'react';

const SettingsPage = () => {
  const [settings, setSettings] = useState({});

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const response = await fetch('http://localhost:8000/settings');
    const data = await response.json();
    setSettings(data);
  };

  const updateSettings = async (updates) => {
    const newSettings = { ...settings, ...updates };
    const response = await fetch('http://localhost:8000/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    if (response.ok) {
      alert('Settings saved');
      setSettings(newSettings);
    }
  };

  const handleExportNow = async () => {
    await fetch('http://localhost:8000/export/trigger', { method: 'POST' });
    alert('Export triggered');
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px', color: 'var(--text-primary)' }}>Settings</h1>

      <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Detection</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={settings.lpr_enabled || false} onChange={(e) => setSettings({ ...settings, lpr_enabled: e.target.checked })} />
            LPR Enabled
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Confidence Threshold: {settings.lpr_confidence_threshold || 0.5}
            <input type="range" min="0" max="1" step="0.1" value={settings.lpr_confidence_threshold || 0.5} onChange={(e) => setSettings({ ...settings, lpr_confidence_threshold: parseFloat(e.target.value) })} style={{ width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Region Hint:
            <input type="text" value={settings.lpr_region_hint || ''} onChange={(e) => setSettings({ ...settings, lpr_region_hint: e.target.value })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px' }} />
          </label>
        </div>
        <button className="btn btn-blue" style={{ marginTop: '16px' }} onClick={() => updateSettings({ lpr_enabled: settings.lpr_enabled, lpr_confidence_threshold: settings.lpr_confidence_threshold, lpr_region_hint: settings.lpr_region_hint })}>
          Save
        </button>
      </div>

      <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Vehicle & Slots</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <label style={{ color: 'var(--text-primary)' }}>
            Abandoned Threshold (min):
            <input type="number" value={settings.abandoned_threshold_minutes || 120} onChange={(e) => setSettings({ ...settings, abandoned_threshold_minutes: parseInt(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Wrong-Way Angle (°):
            <input type="number" value={settings.wrong_way_angle_threshold || 120} onChange={(e) => setSettings({ ...settings, wrong_way_angle_threshold: parseInt(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Speed Limit (km/h):
            <input type="number" value={settings.speed_limit_kmh || 10} onChange={(e) => setSettings({ ...settings, speed_limit_kmh: parseFloat(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Alert Threshold (km/h):
            <input type="number" value={settings.speed_alert_kmh || 15} onChange={(e) => setSettings({ ...settings, speed_alert_kmh: parseFloat(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
        </div>
        <button className="btn btn-blue" style={{ marginTop: '16px' }} onClick={() => updateSettings({
          abandoned_threshold_minutes: settings.abandoned_threshold_minutes,
          wrong_way_angle_threshold: settings.wrong_way_angle_threshold,
          speed_limit_kmh: settings.speed_limit_kmh,
          speed_alert_kmh: settings.speed_alert_kmh
        })}>
          Save
        </button>
      </div>

      <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Pricing</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={settings.pricing_enabled || false} onChange={(e) => setSettings({ ...settings, pricing_enabled: e.target.checked })} />
            Pricing Enabled
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <label style={{ color: 'var(--text-primary)' }}>
              Standard ($/hr):
              <input type="number" value={settings.pricing?.standard || 2} onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, standard: parseFloat(e.target.value) } })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
            </label>
            <label style={{ color: 'var(--text-primary)' }}>
              Compact ($/hr):
              <input type="number" value={settings.pricing?.compact || 1} onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, compact: parseFloat(e.target.value) } })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
            </label>
            <label style={{ color: 'var(--text-primary)' }}>
              Large ($/hr):
              <input type="number" value={settings.pricing?.large || 4} onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, large: parseFloat(e.target.value) } })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <label style={{ color: 'var(--text-primary)' }}>
              Grace Period (min):
              <input type="number" value={settings.grace_period_minutes || 15} onChange={(e) => setSettings({ ...settings, grace_period_minutes: parseInt(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
            </label>
            <label style={{ color: 'var(--text-primary)' }}>
              Max Daily Charge:
              <input type="number" value={settings.max_daily_charge || 20} onChange={(e) => setSettings({ ...settings, max_daily_charge: parseFloat(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
            </label>
          </div>
        </div>
        <button className="btn btn-blue" style={{ marginTop: '16px' }} onClick={() => updateSettings({
          pricing_enabled: settings.pricing_enabled,
          pricing: settings.pricing,
          grace_period_minutes: settings.grace_period_minutes,
          max_daily_charge: settings.max_daily_charge
        })}>
          Save
        </button>
      </div>

      <div className="glass" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Export</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={settings.export_enabled || false} onChange={(e) => setSettings({ ...settings, export_enabled: e.target.checked })} />
            Export Enabled
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={settings.email_enabled || false} onChange={(e) => setSettings({ ...settings, email_enabled: e.target.checked })} />
            Email Enabled
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Email Recipient:
            <input type="email" value={settings.email_recipient || ''} onChange={(e) => setSettings({ ...settings, email_recipient: e.target.value })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={settings.s3_enabled || false} onChange={(e) => setSettings({ ...settings, s3_enabled: e.target.checked })} />
            S3 Enabled
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            S3 Bucket:
            <input type="text" value={settings.s3_bucket || ''} onChange={(e) => setSettings({ ...settings, s3_bucket: e.target.value })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
        </div>
        <button className="btn btn-blue" style={{ marginTop: '16px' }} onClick={() => updateSettings({
          export_enabled: settings.export_enabled,
          email_enabled: settings.email_enabled,
          email_recipient: settings.email_recipient,
          s3_enabled: settings.s3_enabled,
          s3_bucket: settings.s3_bucket
        })}>
          Save
        </button>
        <button className="btn btn-green" style={{ marginTop: '16px', marginLeft: '16px' }} onClick={handleExportNow}>
          Export Now
        </button>
      </div>

      <div className="glass" style={{ padding: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Map & Calibration</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <label style={{ color: 'var(--text-primary)' }}>
            Lot Latitude:
            <input type="number" step="0.000001" value={settings.lot_lat || 0} onChange={(e) => setSettings({ ...settings, lot_lat: parseFloat(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Lot Longitude:
            <input type="number" step="0.000001" value={settings.lot_lng || 0} onChange={(e) => setSettings({ ...settings, lot_lng: parseFloat(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Pixels per Meter:
            <input type="number" value={settings.pixels_per_meter || 8} onChange={(e) => setSettings({ ...settings, pixels_per_meter: parseFloat(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <div></div>
          <label style={{ color: 'var(--text-primary)' }}>
            Entrance Pixel X:
            <input type="number" value={settings.entrance_pixel_x || 0} onChange={(e) => setSettings({ ...settings, entrance_pixel_x: parseInt(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
          <label style={{ color: 'var(--text-primary)' }}>
            Entrance Pixel Y:
            <input type="number" value={settings.entrance_pixel_y || 0} onChange={(e) => setSettings({ ...settings, entrance_pixel_y: parseInt(e.target.value) })} className="glass" style={{ padding: '8px', border: 'none', outline: 'none', marginTop: '4px', width: '100%' }} />
          </label>
        </div>
        <button className="btn btn-blue" style={{ marginTop: '16px' }} onClick={() => updateSettings({
          lot_lat: settings.lot_lat,
          lot_lng: settings.lot_lng,
          pixels_per_meter: settings.pixels_per_meter,
          entrance_pixel_x: settings.entrance_pixel_x,
          entrance_pixel_y: settings.entrance_pixel_y
        })}>
          Save
        </button>
      </div>
    </div>
  );
};

export default SettingsPage;
