import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { findNearestSlot } from '../utils/navigationUtils';

const NavigationMap = () => {
  const [settings, setSettings] = useState({});
  const [slots, setSlots] = useState({});
  const [nearest, setNearest] = useState(null);

  useEffect(() => {
    fetchSettings();
    fetchSlots();
  }, []);

  useEffect(() => {
    if (Object.keys(slots).length && settings.entrance_pixel_x) {
      const availableSlots = Object.keys(slots).map(id => ({
        id,
        status: slots[id],
        cx: 0, // Placeholder, assume pixel coords
        cy: 0
      })).filter(s => s.status === 'available');

      const entrancePx = { x: settings.entrance_pixel_x, y: settings.entrance_pixel_y };
      const nearestSlot = findNearestSlot(availableSlots, entrancePx, settings.pixels_per_meter);
      if (nearestSlot) {
        const walkTime = Math.round((nearestSlot.dist / settings.pixels_per_meter) / 1.2 / 10) * 10;
        setNearest({ ...nearestSlot, walkTime });
      }
    }
  }, [slots, settings]);

  const fetchSettings = async () => {
    const response = await fetch('http://localhost:8000/settings');
    const data = await response.json();
    setSettings(data);
  };

  const fetchSlots = async () => {
    const response = await fetch('http://localhost:8000/parking/status');
    const data = await response.json();
    setSlots(data.status || {});
  };

  return (
    <div className="glass" style={{ padding: '20px', height: '100%' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Navigation Map</h2>

      <div style={{ height: '200px', marginBottom: '16px' }}>
        {settings.lot_lat && (
          <MapContainer center={[settings.lot_lat, settings.lot_lng]} zoom={18} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <Marker position={[settings.lot_lat, settings.lot_lng]}>
              <Popup>Entrance</Popup>
            </Marker>
            {/* Add markers for slots if lat/lng available */}
          </MapContainer>
        )}
      </div>

      {nearest && (
        <div style={{
          backgroundColor: 'var(--green)',
          color: '#fff',
          padding: '12px',
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          🟢 Slot {nearest.id} — Zone {nearest.id[0]} — ~{nearest.walkTime} sec walk
        </div>
      )}
    </div>
  );
};

export default NavigationMap;
