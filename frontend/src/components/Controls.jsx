import React, { useState } from 'react';
import { Camera, CameraOff, Wrench, FileText, MoreVertical, Upload } from 'lucide-react';

const Controls = ({ onUpload, cameraOn, setCameraOn }) => {
  const [reportDropdown, setReportDropdown] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);

  const toggleCamera = () => setCameraOn(!cameraOn);

  const handleFileChange = (e) => {
    setUploadedFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!uploadedFile) return;
    const formData = new FormData();
    formData.append('file', uploadedFile);
    try {
      const response = await fetch('http://localhost:8000/upload-video', {
        method: 'POST',
        body: formData,
      });
      if (response.ok) {
        const data = await response.json();
        onUpload(data.url);
        alert(data.message);
      } else {
        alert('Upload failed');
      }
    } catch (error) {
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

        <button className="btn btn-green" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Wrench size={16} />
          Manual Override
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
              zIndex: 10,
              padding: '8px 0',
              marginTop: '4px'
            }}>
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 16px' }}>Export CSV</button>
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 16px' }}>Export PDF</button>
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 16px' }}>Email Report</button>
            </div>
          )}
        </div>

        <input type="file" accept="video/*" onChange={handleFileChange} style={{ marginBottom: '8px' }} />

        <button className="btn btn-purple" onClick={handleUpload} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Upload size={16} />
          Upload Video
        </button>
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
