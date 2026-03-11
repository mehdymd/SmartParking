import React, { useState, useRef } from 'react';
import { Camera, CameraOff, Wrench, FileText, MoreVertical, Upload } from 'lucide-react';

const Controls = ({ onUpload, cameraOn, setCameraOn, hasUploaded }) => {
  const [manualOverride, setManualOverride] = useState(false);
  const [reportDropdown, setReportDropdown] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const fileInputRef = useRef(null);

  const toggleCamera = async () => {
    const next = !cameraOn;
    setCameraOn(next);

    try {
      if (next) {
        // Inform backend to use default webcam (index 0) as video source
        await fetch('http://localhost:8000/parking/set-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 0 })
        });
      } else {
        // Camera off: don't force-clear backend source (upload may be active)
      }
    } catch (e) {
      console.error('Error syncing camera source with backend', e);
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
      const response = await fetch('http://localhost:8000/parking/upload-feed', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        alert('Upload failed');
        return;
      }

      const data = await response.json();
      setUploadedFile(null);
      alert('Upload successful');
      if (onUpload) {
        // Store the backend-provided source (or any truthy value)
        onUpload(data.source || true);
      }
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

  return (
    <div className="glass" style={{ padding: '20px', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>Controls</h2>
        <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <MoreVertical size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
        <button className={`btn ${cameraOn ? 'btn-red' : 'btn-blue'}`} onClick={toggleCamera} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {cameraOn ? <CameraOff size={16} /> : <Camera size={16} />}
          {cameraOn ? 'Stop Camera' : 'Start Camera'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
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

        <button className="btn btn-purple" onClick={handleUpload} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Upload size={16} />
          Upload Video
        </button>

        <button
          className="btn btn-blue"
          disabled={!hasUploaded}
          onClick={() => setCameraOn(false)}
          style={{ width: '100%', opacity: hasUploaded ? 1 : 0.5, cursor: hasUploaded ? 'pointer' : 'not-allowed' }}
        >
          Play Uploaded Video
        </button>

        <div style={{ position: 'relative' }}>
          <button className="btn btn-blue" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => setReportDropdown(!reportDropdown)}>
            <FileText size={16} />
            Generate Report ▾
          </button>
          {reportDropdown && (
            <div className="glass" style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              backgroundColor: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              padding: '8px',
              zIndex: 10,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              <button style={{
              }} onMouseEnter={(e) => e.target.style.backgroundColor = '#1e7e34'} onMouseLeave={(e) => e.target.style.backgroundColor = '#28a745'}>
                Export PDF
              </button>
              <button onClick={() => fileInputRef.current?.click()} style={{ backgroundColor: 'purple', color: 'white' }}>Upload Video</button>
              <button style={{
                width: '100%',
                backgroundColor: 'orange',
                color: 'white',
                padding: '8px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                marginBottom: '4px',
                transition: 'background-color 0.2s',
                fontWeight: 'bold'
              }} onClick={() => fetch('/export/trigger', { method: 'POST' })} onMouseEnter={(e) => e.target.style.backgroundColor = '#e0a800'} onMouseLeave={(e) => e.target.style.backgroundColor = '#ffc107'}>
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
