import React, { useEffect, useState, useRef } from 'react';
import { Camera, CameraOff, FileText, MoreVertical, Upload } from 'lucide-react';
import { apiUrl } from '../lib/api';

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

const getModeFromStatus = (status) => {
  if (status?.mode) return status.mode;
  if (status?.source === 0 || status?.source === '0') return 'camera';
  if (status?.source) return 'upload';
  return 'none';
};

const Controls = ({ feedState, setFeedState }) => {
  const [reportDropdown, setReportDropdown] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [cameraStatus, setCameraStatus] = useState({ active: false, open: false, source: null });
  const fileInputRef = useRef(null);
  const cameraOn = feedState?.mode === 'camera';

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(apiUrl('/parking/camera-status'));
        if (!res.ok) return;
        const data = await res.json();
        setCameraStatus(data);
        const nextMode = getModeFromStatus(data);
        const nextSource = data?.source ?? null;
        setFeedState((prev) => {
          if (prev?.mode === nextMode && prev?.source === nextSource) {
            return prev;
          }
          return {
            mode: nextMode,
            source: nextSource,
            token: Date.now(),
          };
        });
      } catch {
        setCameraStatus({ active: false, open: false, source: null });
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [setFeedState]);

  const toggleCamera = async () => {
    const next = !cameraOn;

    try {
      if (next) {
        // Switch to webcam source
        const response = await fetch(apiUrl('/parking/set-source'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: "0" })
        });
        if (!response.ok) {
          throw new Error('Camera not available');
        }
        const payload = await response.json().catch(() => ({}));
        setFeedState({
          mode: payload.mode || 'camera',
          source: payload.source ?? '0',
          token: Date.now(),
        });
      } else {
        // Clear source
        const response = await fetch(apiUrl('/parking/set-source'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: null })
        });
        if (!response.ok) {
          throw new Error('Failed to clear source');
        }
        setFeedState({
          mode: 'none',
          source: null,
          token: Date.now(),
        });
      }
    } catch (e) {
      console.error('Error syncing camera source with backend', e);
      alert(`Failed to ${next ? 'start' : 'stop'} camera: ${e.message}`);
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
      if (!response.ok) {
        alert('Upload failed');
        return;
      }

      const data = await response.json();
      setUploadedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      alert('Upload successful');
      setFeedState({
        mode: data.mode || 'upload',
        source: data.source || null,
        token: Date.now(),
      });
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed');
    }
  };

  const healthItems = [
    { label: 'Backend API', status: 'connected' },
    { label: 'WebSocket', status: 'live' },
    { label: 'YOLOv8 Model', status: 'loaded' }
  ];

  const getDotColor = (status) => {
    switch (status) {
      case 'connected': return 'var(--green)';
      case 'live': return 'var(--green)';
      case 'loaded': return 'var(--green)';
      case 'disconnected': return 'var(--red)';
      case 'reconnecting': return 'var(--amber)';
      case 'loading': return 'var(--amber)';
      default: return 'var(--red)';
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: cameraStatus?.active ? 'var(--green)' : 'var(--red)'
          }} />
          Camera: {cameraStatus?.active ? 'active' : 'disconnected'}
        </div>
        <button className={`btn ${cameraOn ? 'btn-red' : 'btn-blue'}`} onClick={toggleCamera} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {cameraOn ? <CameraOff size={16} /> : <Camera size={16} />}
          {cameraOn ? 'Stop Webcam' : 'Use Webcam'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          onChange={handleFileChange}
          style={{
            width: '100%',
            padding: '10px',
            border: '1px solid var(--panel-border)',
            borderRadius: '4px',
            backgroundColor: 'var(--panel-bg)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            marginBottom: '8px'
          }}
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
              marginTop: '4px'
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
        {healthItems.map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: getDotColor(item.status)
            }}></div>
            <span>{item.label}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
              {item.status === 'connected' ? 'Connected' :
               item.status === 'live' ? 'Live' :
               item.status === 'loaded' ? 'Loaded' :
               item.status === 'disconnected' ? 'Disconnected' :
               item.status === 'reconnecting' ? 'Reconnecting…' :
               'Loading…'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Controls;
