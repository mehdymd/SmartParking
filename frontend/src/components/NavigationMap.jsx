import React, { useMemo, useState, useEffect } from 'react';
import { findNearestSlot } from '../utils/navigationUtils';
import { apiUrl } from '../lib/api';

const NavigationMap = () => {
  const [settings, setSettings] = useState({});
  const [slots, setSlots] = useState({});
  const [nearest, setNearest] = useState(null);
  const [polygons, setPolygons] = useState([]);

  useEffect(() => {
    fetchSettings();
    fetchSlots();
    fetchPolygons();
    const interval = setInterval(fetchSlots, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!Object.keys(slots).length) return;
    const entrancePx = settings.entrance_pixel_x != null
      ? { x: Number(settings.entrance_pixel_x), y: Number(settings.entrance_pixel_y) }
      : null;
    const ppm = Number(settings.pixels_per_meter || 0);

    // Compute centroids for polygons so "nearest" is real (not placeholder zeros).
    const slotPoints = Object.keys(slots).map((id) => {
      const idx = Number(id.replace('S', '')) - 1;
      const poly = polygons[idx];
      let cx = 0;
      let cy = 0;
      if (Array.isArray(poly) && poly.length) {
        const pts = poly.map(p => ({ x: Number(p.x ?? p[0] ?? 0), y: Number(p.y ?? p[1] ?? 0) }));
        cx = pts.reduce((acc, p) => acc + p.x, 0) / pts.length;
        cy = pts.reduce((acc, p) => acc + p.y, 0) / pts.length;
      }
      return { id, status: slots[id], cx, cy };
    });

    const nearestSlot = entrancePx ? findNearestSlot(slotPoints, entrancePx, ppm || 1) : slotPoints.find(s => s.status === 'available');
    if (!nearestSlot) {
      setNearest(null);
      return;
    }
    const distMeters = entrancePx && ppm ? (nearestSlot.dist / ppm) : null;
    const walkTime = distMeters != null ? Math.round((distMeters / 1.2) / 10) * 10 : null;
    setNearest({ ...nearestSlot, distMeters, walkTime });
  }, [slots, settings, polygons]);

  const fetchSettings = async () => {
    try {
      const response = await fetch(apiUrl('/settings'));
      const data = await response.json();
      setSettings(data || {});
    } catch {
      setSettings({});
    }
  };

  const fetchSlots = async () => {
    try {
      const response = await fetch(apiUrl('/parking/status'));
      const data = await response.json();
      setSlots(data.status || {});
    } catch {
      setSlots({});
    }
  };

  const fetchPolygons = async () => {
    try {
      const response = await fetch(apiUrl('/parking/slots'));
      const data = await response.json();
      setPolygons(Array.isArray(data.polygons) ? data.polygons : []);
    } catch {
      setPolygons([]);
    }
  };

  const availableCount = useMemo(
    () => Object.values(slots).filter((s) => s === 'available').length,
    [slots]
  );

  return (
    <div className="glass" style={{ padding: '16px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-primary)' }}>Navigation Map</h2>

      <div style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6 }}>
        <div>Available slots: <span style={{ color: 'var(--green)', fontWeight: 700 }}>{availableCount}</span></div>
        <div>
          Entrance reference: {settings.entrance_pixel_x != null ? `(${settings.entrance_pixel_x}, ${settings.entrance_pixel_y}) px` : 'Not configured'}
        </div>
      </div>

      {nearest && (
        <div style={{
          backgroundColor: 'var(--green)',
          color: '#fff',
          padding: '12px',
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          Recommended: Slot {nearest.id}
          {nearest.walkTime != null ? ` — ~${nearest.walkTime} sec walk` : ''}
        </div>
      )}
      {!nearest && (
        <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
          No available slots found.
        </div>
      )}
    </div>
  );
};

export default NavigationMap;
