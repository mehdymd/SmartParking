import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  FileText,
  MoreVertical,
  Plus,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { apiUrl } from '../lib/api';
import { authFetch } from '../lib/auth';

const dropdownItemStyle = {
  width: '100%',
  background: 'transparent',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '12px',
  textAlign: 'left',
  display: 'block',
  transition: 'background 0.12s',
  fontWeight: 500,
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--panel-border)',
  borderRadius: '10px',
  backgroundColor: 'rgba(255,255,255,0.03)',
  color: 'var(--text-primary)',
  fontSize: '13px',
};

const getModeFromStatus = (status) => {
  if (status?.mode) return status.mode;
  if (typeof status?.source === 'number' || String(status?.source || '').match(/^\d+$/)) return 'camera';
  if (status?.source) return 'upload';
  return 'none';
};

const Controls = ({ feedState, setFeedState, token, currentUser }) => {
  const [reportDropdown, setReportDropdown] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [cameraStatus, setCameraStatus] = useState({ active: false, open: false, source: null, cameras: [] });
  const [cameraForm, setCameraForm] = useState({ name: '', source: '' });
  const [cameraActionLoading, setCameraActionLoading] = useState(false);
  const fileInputRef = useRef(null);
  const cameraOn = feedState?.mode === 'camera';
  const isAdmin = currentUser?.role === 'admin';

  const cameraRegistry = cameraStatus?.cameras || [];
  const activeCamera = cameraRegistry.find((camera) => camera.id === cameraStatus?.active_camera_id || camera.is_active) || null;

  const syncFeedState = useCallback((data) => {
    const nextMode = getModeFromStatus(data);
    const nextSource = data?.source ?? null;
    const nextActiveCameraId = data?.active_camera_id ?? null;
    const nextCameras = data?.cameras || [];
    setFeedState((prev) => {
      if (
        prev?.mode === nextMode &&
        prev?.source === nextSource &&
        prev?.activeCameraId === nextActiveCameraId &&
        JSON.stringify(prev?.cameras || []) === JSON.stringify(nextCameras)
      ) {
        return prev;
      }
      return {
        mode: nextMode,
        source: nextSource,
        token: Date.now(),
        activeCameraId: nextActiveCameraId,
        cameras: nextCameras,
      };
    });
  }, [setFeedState]);

  const refreshStatus = useCallback(async () => {
    const res = await fetch(apiUrl('/parking/camera-status'));
    if (!res.ok) return;
    const data = await res.json();
    setCameraStatus(data);
    syncFeedState(data);
  }, [syncFeedState]);

  useEffect(() => {
    const poll = async () => {
      try {
        await refreshStatus();
      } catch {
        setCameraStatus({ active: false, open: false, source: null, cameras: [] });
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  const toggleCamera = async () => {
    const next = !cameraOn;
    try {
      const response = await fetch(apiUrl('/parking/set-source'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: next ? 0 : null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || (next ? 'Camera not available' : 'Failed to clear source'));
      }
      await refreshStatus();
    } catch (e) {
      console.error('Error syncing camera source with backend', e);
      alert(`Failed to ${next ? 'start' : 'stop'} camera: ${e.message}`);
    }
  };

  const activateCamera = async (cameraId) => {
    if (!token) return;
    setCameraActionLoading(true);
    try {
      const response = await authFetch(`/parking/cameras/${encodeURIComponent(cameraId)}/activate`, {
        method: 'POST',
      }, token);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Failed to activate camera');
      await refreshStatus();
    } catch (error) {
      alert(error.message || 'Failed to activate camera');
    } finally {
      setCameraActionLoading(false);
    }
  };

  const createCamera = async () => {
    if (!token) return;
    const name = cameraForm.name.trim();
    const source = cameraForm.source.trim();
    if (!name || !source) {
      alert('Camera name and source are required');
      return;
    }

    setCameraActionLoading(true);
    try {
      const response = await authFetch('/parking/cameras', {
        method: 'POST',
        body: JSON.stringify({ name, source }),
      }, token);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Failed to add camera');
      setCameraForm({ name: '', source: '' });
      await refreshStatus();
    } catch (error) {
      alert(error.message || 'Failed to add camera');
    } finally {
      setCameraActionLoading(false);
    }
  };

  const removeCamera = async (cameraId) => {
    if (!token) return;
    setCameraActionLoading(true);
    try {
      const response = await authFetch(`/parking/cameras/${encodeURIComponent(cameraId)}`, {
        method: 'DELETE',
      }, token);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Failed to remove camera');
      await refreshStatus();
    } catch (error) {
      alert(error.message || 'Failed to remove camera');
    } finally {
      setCameraActionLoading(false);
    }
  };

  const handleFileChange = (e) => {
    setUploadedFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!uploadedFile) return;
    const formData = new FormData();
    formData.append('file', uploadedFile);
    try {
      const response = await fetch(apiUrl('/parking/upload-feed'), {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Upload failed');
      }

      setUploadedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      alert('Upload successful');
      await refreshStatus();
    } catch (error) {
      console.error('Upload error:', error);
      alert(error.message || 'Upload failed');
    }
  };

  const healthItems = [
    { label: 'Backend API', status: 'connected' },
    { label: 'WebSocket', status: 'live' },
    { label: 'YOLOv8 Model', status: 'loaded' },
    { label: 'Camera Deck', status: cameraRegistry.length ? 'live' : 'loading' },
  ];

  const getDotColor = (status) => {
    switch (status) {
      case 'connected':
      case 'live':
      case 'loaded':
        return 'var(--green)';
      case 'reconnecting':
      case 'loading':
        return 'var(--amber)';
      default:
        return 'var(--red)';
    }
  };

  const downloadReport = async (url, fallbackName) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Report generation failed');
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename=([^;]+)/i);
      link.href = objectUrl;
      link.download = (match?.[1] || fallbackName).replace(/"/g, '');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      alert(error.message || 'Report generation failed');
    }
  };

  const emailReport = async () => {
    try {
      const response = await fetch(apiUrl('/export/report/email'), { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || 'Email report failed');
      }
      alert(payload.message || 'Report emailed');
    } catch (error) {
      alert(error.message || 'Email report failed');
    } finally {
      setReportDropdown(false);
    }
  };

  return (
    <div className="glass" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Controls</h2>
        <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <MoreVertical size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
        <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: cameraStatus?.active ? 'var(--green)' : 'var(--red)' }} />
            Feed status: {cameraStatus?.active ? 'active' : 'disconnected'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
            {activeCamera?.name || (feedState?.mode === 'upload' ? 'Uploaded feed active' : 'No named camera active')}
          </div>
        </div>

        <button className={`btn ${cameraOn ? 'btn-red' : 'btn-blue'}`} onClick={toggleCamera} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {cameraOn ? <CameraOff size={16} /> : <Camera size={16} />}
          {cameraOn ? 'Stop Webcam' : 'Use Webcam'}
        </button>

        <div style={{ display: 'grid', gap: '10px', padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}>
            <Video size={16} />
            Camera Deck
          </div>
          {cameraRegistry.length ? cameraRegistry.map((camera) => (
            <div key={camera.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '10px', padding: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', background: camera.is_active ? 'rgba(52,152,219,0.12)' : 'rgba(255,255,255,0.02)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700 }}>{camera.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {camera.is_active ? 'Active camera' : camera.mode}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-blue"
                  disabled={cameraActionLoading || camera.is_active}
                  onClick={() => activateCamera(camera.id)}
                  style={{ width: 'auto', height: '38px', padding: '0 12px' }}
                >
                  Use
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-red"
                    disabled={cameraActionLoading}
                    onClick={() => removeCamera(camera.id)}
                    style={{ width: '38px', height: '38px', padding: 0 }}
                    title="Remove camera"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          )) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.6 }}>
              No saved cameras yet. Add RTSP, device indexes like `0` or `1`, or local video-device paths to build a reusable multi-camera deck.
            </div>
          )}
        </div>

        {isAdmin && (
          <div style={{ display: 'grid', gap: '10px', padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Add Camera
            </div>
            <input
              value={cameraForm.name}
              onChange={(e) => setCameraForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Front Gate Camera"
              style={inputStyle}
            />
            <input
              value={cameraForm.source}
              onChange={(e) => setCameraForm((prev) => ({ ...prev, source: e.target.value }))}
              placeholder="0, 1, /dev/video1, rtsp://..., or file path"
              style={inputStyle}
            />
            <button className="btn btn-green" disabled={cameraActionLoading} onClick={createCamera} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Plus size={16} />
              Add Camera
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          onChange={handleFileChange}
          style={inputStyle}
        />

        <button className="btn btn-green" onClick={handleUpload} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Upload size={16} />
          Upload Feed
        </button>

        <div style={{ position: 'relative' }}>
          <button className="btn btn-blue" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => setReportDropdown(!reportDropdown)}>
            <FileText size={16} />
            Generate Report ▾
          </button>
          {reportDropdown && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: '#1e1e22',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              padding: '4px',
              zIndex: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              marginTop: '4px',
            }}>
              <button onClick={() => { downloadReport(apiUrl('/export/report/pdf'), 'SmartParking_Report.pdf'); setReportDropdown(false); }} style={dropdownItemStyle}>
                Export PDF
              </button>
              <button onClick={() => { downloadReport(apiUrl('/export/report/excel'), 'SmartParking_Report.xlsx'); setReportDropdown(false); }} style={dropdownItemStyle}>
                Export Excel
              </button>
              <button onClick={emailReport} style={dropdownItemStyle}>
                Email Report
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '12px', color: 'var(--text-primary)' }}>
        <div style={{ marginBottom: '8px', fontWeight: '600' }}>System Health</div>
        {healthItems.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: getDotColor(item.status) }} />
            <span>{item.label}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
              {item.status === 'connected' ? 'Connected' :
               item.status === 'live' ? 'Live' :
               item.status === 'loaded' ? 'Loaded' :
               item.status === 'loading' ? 'Ready for setup' :
               item.status === 'reconnecting' ? 'Reconnecting…' :
               'Disconnected'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Controls;
