import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { apiUrl } from '../lib/api';

const ZONE_LEGEND = [
  { key: 'A', label: 'Standard', color: '#F59E0B' },
  { key: 'B', label: 'Economy', color: '#3498DB' },
  { key: 'C', label: 'Premium', color: '#9B59B6' },
];

const FLOW_LEGEND = [
  { key: 'ENTRY', label: 'Entry Zone', color: '#10B981' },
  { key: 'EXIT', label: 'Exit Zone', color: '#5E3FF4' },
];

const STATE_LEGEND = [
  { key: 'AVAILABLE', label: 'Available Slot', color: '#F59E0B' },
  { key: 'RESERVED', label: 'Reserved Slot', color: '#FFC400' },
  { key: 'OCCUPIED', label: 'Occupied Slot', color: '#8C5A00' },
];

const feedImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  background: '#05070b',
};

const LiveFeed = ({ feedState }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadedPlaying, setUploadedPlaying] = useState(true);
  const [overlayData, setOverlayData] = useState({ polygons: [], entry_zone: null, exit_zone: null, frame_width: 1280, frame_height: 720 });
  const [streamError, setStreamError] = useState('');
  const cameraOn = feedState?.mode === 'camera';
  const uploadedSrc = feedState?.mode === 'upload' ? feedState?.source : null;
  const activeCamera = (feedState?.cameras || []).find((camera) => camera.id === feedState?.activeCameraId || camera.is_active) || null;

  useEffect(() => {
    if (feedState?.mode === 'camera' || feedState?.mode === 'upload') {
      setRefreshKey(Date.now());
      setStreamError('');
    }
    if (feedState?.mode === 'upload') {
      setUploadedPlaying(true);
    }
  }, [feedState?.mode, feedState?.source, feedState?.token]);

  useEffect(() => {
    if (!(cameraOn || uploadedSrc)) return;

    let active = true;
    const loadOverlay = async () => {
      try {
        const response = await fetch(apiUrl('/parking/slots'));
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        setOverlayData({
          polygons: [],
          entry_zone: Array.isArray(data.entry_zone) ? data.entry_zone : null,
          exit_zone: Array.isArray(data.exit_zone) ? data.exit_zone : null,
          frame_width: Number(data.frame_width) || 1280,
          frame_height: Number(data.frame_height) || 720,
        });
      } catch {
        if (!active) return;
        setOverlayData((prev) => ({ ...prev, polygons: [], entry_zone: null, exit_zone: null }));
      }
    };

    loadOverlay();
    const id = setInterval(loadOverlay, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [cameraOn, uploadedSrc, feedState?.token]);

  const restart = () => {
    if (cameraOn) {
      setRefreshKey(Date.now());
    } else if (uploadedSrc) {
      setRefreshKey(Date.now());
    }
  };

  const pointsToString = (points) => (points || [])
    .map((point) => `${Number(point.x ?? point[0] ?? 0)},${Number(point.y ?? point[1] ?? 0)}`)
    .join(' ');

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '400px' }}>
      {cameraOn ? (
        <>
          <img
            src={apiUrl(`/parking/video-feed?key=${refreshKey}`)}
            style={feedImageStyle}
            alt="Live Camera Feed"
            onLoad={() => setStreamError('')}
            onError={() => setStreamError('Live camera stream is unavailable. Check the backend and selected source.')}
          />
          <div style={{
            position: 'absolute', top: '10px', left: '10px',
            backgroundColor: 'rgba(0,255,0,0.8)', color: 'white',
            padding: '4px 8px', borderRadius: '4px', fontSize: '12px'
          }}>
            {activeCamera?.name ? `LIVE CAMERA · ${activeCamera.name}` : 'LIVE CAMERA'}
          </div>
        </>
      ) : uploadedSrc ? (
        <>
          <img
            src={
              uploadedPlaying
                ? apiUrl(`/parking/video-feed?key=${refreshKey}`)
                : apiUrl(`/parking/snapshot?annotated=1&key=${refreshKey}`)
            }
            style={feedImageStyle}
            alt="Annotated Video Feed"
            onLoad={() => setStreamError('')}
            onError={() => setStreamError('Uploaded feed is unavailable. Re-upload the file or restart the backend stream.')}
          />
          <div style={{
            position: 'absolute', top: '10px', left: '10px',
            backgroundColor: 'rgba(255,0,0,0.8)', color: 'white',
            padding: '4px 8px', borderRadius: '4px', fontSize: '12px'
          }}>
            {activeCamera?.name ? `PROCESSED VIDEO · ${activeCamera.name}` : 'PROCESSED VIDEO'}
          </div>
          <div style={{ position: 'absolute', bottom: '10px', left: '10px', display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setUploadedPlaying((p) => !p)}
              style={{
                padding: '6px 10px', background: 'rgba(0,0,0,0.5)', color: 'white',
                border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
              }}
            >
              {uploadedPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={() => { setRefreshKey(Date.now()); setUploadedPlaying(true); }}
              style={{
                padding: '6px 10px', background: 'rgba(0,0,0,0.5)', color: 'white',
                border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
              }}
            >
              Replay
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: '18px' }}>
          No live feed active. Upload a video or start camera.
        </div>
      )}

      {streamError && (
        <div style={{
          position: 'absolute',
          left: '50%',
          bottom: '18px',
          transform: 'translateX(-50%)',
          background: 'rgba(123, 24, 24, 0.88)',
          color: '#ffd9d9',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '10px',
          padding: '10px 14px',
          fontSize: '12px',
          maxWidth: 'min(92%, 520px)',
          textAlign: 'center',
          backdropFilter: 'blur(6px)',
        }}>
          {streamError}
        </div>
      )}

      {(cameraOn || uploadedSrc) && (
        <svg
          viewBox={`0 0 ${overlayData.frame_width} ${overlayData.frame_height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {overlayData.entry_zone?.length >= 2 && (
            <g>
              <polygon
                points={pointsToString(overlayData.entry_zone)}
                fill="rgba(16,185,129,0.16)"
                stroke="#10B981"
                strokeWidth="3"
              />
              <text
                x={Number(overlayData.entry_zone[0].x ?? overlayData.entry_zone[0][0] ?? 0)}
                y={Math.max(18, Number(overlayData.entry_zone[0].y ?? overlayData.entry_zone[0][1] ?? 0) - 10)}
                fill="#10B981"
                fontSize="16"
                fontWeight="800"
              >
                ENTRY
              </text>
            </g>
          )}
          {overlayData.exit_zone?.length >= 2 && (
            <g>
              <polygon
                points={pointsToString(overlayData.exit_zone)}
                fill="rgba(94,63,244,0.14)"
                stroke="#5E3FF4"
                strokeWidth="3"
              />
              <text
                x={Number(overlayData.exit_zone[0].x ?? overlayData.exit_zone[0][0] ?? 0)}
                y={Math.max(18, Number(overlayData.exit_zone[0].y ?? overlayData.exit_zone[0][1] ?? 0) - 10)}
                fill="#5E3FF4"
                fontSize="16"
                fontWeight="800"
              >
                EXIT
              </text>
            </g>
          )}
        </svg>
      )}

      {/* Zone legend overlay */}
      {(cameraOn || uploadedSrc) && (
        <div style={{
          position: 'absolute', top: '10px', right: '10px',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
          borderRadius: '8px', padding: '8px 12px',
          display: 'flex', flexDirection: 'column', gap: '4px',
        }}>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>
            Zones
          </div>
          {ZONE_LEGEND.map((z) => (
            <div key={z.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: z.color }} />
              <span style={{ fontSize: '11px', color: '#fff' }}>
                {z.key} – {z.label}
              </span>
            </div>
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />
          {STATE_LEGEND.map((z) => (
            <div key={z.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: z.color }} />
              <span style={{ fontSize: '11px', color: '#fff' }}>
                {z.label}
              </span>
            </div>
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />
          {FLOW_LEGEND.map((z) => (
            <div key={z.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '999px', background: z.color }} />
              <span style={{ fontSize: '11px', color: '#fff' }}>
                {z.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Refresh button */}
      {cameraOn && (
        <div style={{ position: 'absolute', bottom: '10px', left: '10px', display: 'flex', gap: '8px' }}>
          <button onClick={restart} style={{ padding: '6px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '4px' }}>
            <RotateCcw size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default LiveFeed;
