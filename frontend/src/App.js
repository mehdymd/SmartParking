import React, { useState, useEffect, useRef } from 'react';
import './App.css';

/* eslint-disable no-undef */

function App() {
  const [parkingData, setParkingData] = useState({
    status: {},
    stats: { total: 0, occupied: 0, available: 0, occupancy_rate: 0 }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [videoFile, setVideoFile] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [currentFrame, setCurrentFrame] = useState(null);
  const [uploadedVideoSrc, setUploadedVideoSrc] = useState(null);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [detectedImage, setDetectedImage] = useState(null);
  const [polygons, setPolygons] = useState([]);
  const overlayCanvasRef = useRef(null);

  const fetchPolygons = async () => {
    try {
      const response = await fetch('http://localhost:8000/parking/slots');
      const data = await response.json();
      setPolygons(data.polygons || []);
    } catch (error) {
      console.error('Failed to fetch polygons:', error);
    }
  };

  useEffect(() => {
    fetchPolygons();
  }, []);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    polygons.forEach(poly => {
      if (poly.length > 1) {
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i][0], poly[i][1]);
        }
        ctx.closePath();
        ctx.stroke();
      }
    });
  }, [polygons]);

  const startAnnotation = () => {
    const cameraVideo = document.getElementById('camera-video');
    const uploadedVideo = document.getElementById('uploaded-video');
    let videoElement = null;

    if (uploadedVideo && uploadedVideo.src) {
      videoElement = uploadedVideo;
    } else if (cameraVideo && cameraVideo.videoWidth > 0) {
      videoElement = cameraVideo;
    }

    if (!videoElement) {
      alert('No video available for annotation. Upload a video or start the camera.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0);
    const dataURL = canvas.toDataURL('image/jpeg');
    setCurrentFrame(dataURL);
    setIsAnnotating(true);
    setAnnotations([]);
    setCurrentPoints([]);
  };

  const handleCanvasMouseDown = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCurrentPoints(prev => {
      const newPoints = [...prev, {x, y}];
      if (newPoints.length === 4) {
        setAnnotations(prevAnn => [...prevAnn, newPoints]);
        return [];
      }
      return newPoints;
    });
  };

  const saveAnnotations = async () => {
    try {
      const response = await fetch('http://localhost:8000/update-parking-slots', {
        method: 'POST',
        body: JSON.stringify({ parking_slots: annotations }),
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      alert(result.message);
      setIsAnnotating(false);
      fetchPolygons(); // Update overlay with new polygons
    } catch (error) {
      console.error('Save failed:', error);
    }
  };

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/parking-updates');

    ws.onopen = () => setIsLoading(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setParkingData(data);
        setLastUpdate(new Date());
        setError(null);
      } catch (e) {
        setError('Failed to parse data');
      }
    };
    ws.onerror = () => setError('Connection error');
    ws.onclose = () => setError('Connection closed');

    return () => ws.close();
  }, []);

  if (isAnnotating) {
    return (
      <div className="annotation">
        <h1>Annotate Parking Slots</h1>
        <p>Click on the image to define 4 points for a parking slot polygon. After 4 points, the slot is added. Repeat for multiple slots.</p>
        <p>Current points: {currentPoints.map(p => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ')}</p>
        <div className="annotation-canvas">
          <canvas
            width={640}
            height={480}
            style={{ backgroundImage: `url(${currentFrame})`, backgroundSize: 'cover' }}
            onMouseDown={handleCanvasMouseDown}
          />
          {currentPoints.map((p, idx) => (
            <div
              key={`current-${idx}`}
              style={{
                position: 'absolute',
                left: `${p.x - 2}px`,
                top: `${p.y - 2}px`,
                width: '4px',
                height: '4px',
                background: 'red',
                borderRadius: '50%',
                zIndex: 10
              }}
            />
          ))}
          {annotations.map((poly, polyIdx) => poly.map((p, pidx) => (
            <div
              key={`saved-${polyIdx}-${pidx}`}
              style={{
                position: 'absolute',
                left: `${p.x - 2}px`,
                top: `${p.y - 2}px`,
                width: '4px',
                height: '4px',
                background: 'green',
                borderRadius: '50%',
                zIndex: 10
              }}
            />
          )))}
          <ul>
            {annotations.map((poly, idx) => (
              <li key={idx}>Slot {idx+1}: {poly.map(p => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' -> ')}</li>
            ))}
          </ul>
        </div>
        <div className="annotation-controls">
          <button onClick={saveAnnotations}>Save Annotations</button>
          <button onClick={() => setIsAnnotating(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const handleFileChange = (e) => {
    setVideoFile(e.target.files[0]);
  };

  const handleUpload = () => {
    if (!videoFile) return;
    const videoSrc = URL.createObjectURL(videoFile);
    setUploadedVideoSrc(videoSrc);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      const video = document.getElementById('camera-video');
      video.srcObject = stream;
    } catch (error) {
      console.error('Camera access denied:', error);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  const detectFrame = async () => {
    const video = document.getElementById('camera-video');
    if (!video.videoWidth || !video.videoHeight) {
      alert('Video not ready');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const dataURL = canvas.toDataURL('image/jpeg');
    const base64 = dataURL.split(',')[1];
    try {
      const response = await fetch('http://localhost:8000/detect-frame', {
        method: 'POST',
        body: JSON.stringify({ image: base64 }),
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      setDetectedImage('data:image/jpeg;base64,' + result.image);
    } catch (error) {
      console.error('Detection failed:', error);
    }
  };

  if (isLoading) return <div className="loading">Loading parking data...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const { status, stats } = parkingData;
  const slotLabels = Object.keys(status);
  const availableSlots = slotLabels.filter(slot => status[slot] === 'available');
  const highOccupancy = stats.occupancy_rate > 80;

  return (
    <div className="app">
      <header className="header">
        <h1>🚗 Smart Parking</h1>
        <div className="update-time">Updated: {lastUpdate.toLocaleTimeString()}</div>
        {highOccupancy && <div className="alert">⚠️ Parking is almost full!</div>}
      </header>

      <main className="main">
        <section className="video-section">
          <h2>Live Video Feed</h2>
          <div className="video-container">
            <video id="camera-video" autoPlay style={{ width: '100%', maxWidth: '640px' }}></video>
            <canvas ref={overlayCanvasRef} className="overlay-canvas" width="640" height="480"></canvas>
          </div>
          {uploadedVideoSrc && (
            <div className="video-container" style={{ marginTop: '1rem' }}>
              <video id="uploaded-video" src={uploadedVideoSrc} controls style={{ width: '100%', maxWidth: '640px' }}></video>
              <canvas className="overlay-canvas" width="640" height="480"></canvas>
            </div>
          )}
          {detectedImage && <img src={detectedImage} alt="Detected" style={{ width: '100%', maxWidth: '640px', marginTop: '1rem', borderRadius: '12px' }} />}
        </section>

        <section className="parking-grid">
          <h2>Parking Slots</h2>
          <div className="slots-container">
            {Object.entries(status).map(([id, stat]) => (
              <div key={id} className={`slot ${stat}`}>
                <div className="slot-id">Slot {id}</div>
                <div className="slot-status">{stat}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-section">
          <h2>Parking Statistics</h2>
          <div className="stats-grid">
            <div className="stat-card total">
              <div className="stat-number">{stats.total}</div>
              <div className="stat-label">Total Spaces</div>
            </div>
            <div className="stat-card available">
              <div className="stat-number">{stats.available}</div>
              <div className="stat-label">Available</div>
            </div>
            <div className="stat-card occupied">
              <div className="stat-number">{stats.occupied}</div>
              <div className="stat-label">Occupied</div>
            </div>
            <div className={`stat-card rate ${highOccupancy ? 'high' : ''}`}>
              <div className="stat-number">{stats.occupancy_rate}%</div>
              <div className="stat-label">Occupancy Rate</div>
            </div>
          </div>
        </section>

        <section className="controls-section">
          <h2>Controls</h2>
          <div className="upload-controls">
            <input type="file" accept="video/*" onChange={handleFileChange} />
            <button onClick={handleUpload}>Load Video</button>
          </div>
          <div className="camera-controls">
            <button onClick={startCamera}>Start Camera</button>
            <button onClick={stopCamera}>Stop Camera</button>
            <button onClick={detectFrame}>Detect Vehicles</button>
            <button onClick={startAnnotation}>Annotate Parking Slots</button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
