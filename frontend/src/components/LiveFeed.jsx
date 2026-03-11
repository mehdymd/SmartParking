import React, { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';

const LiveFeed = ({ uploadedSrc, cameraOn }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadedPlaying, setUploadedPlaying] = useState(true);

  // When an upload is present, refresh the processed MJPEG feed key
  useEffect(() => {
    if (uploadedSrc) {
      setRefreshKey(Date.now());
      setUploadedPlaying(true);
    }
  }, [uploadedSrc]);

  const restart = () => {
    if (cameraOn) {
      setRefreshKey(Date.now());
    } else if (uploadedSrc) {
      // For processed uploads we show an MJPEG image; just refresh the feed
      setRefreshKey(Date.now());
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {cameraOn ? (
        <>
          <img
            src={`http://localhost:8000/parking/video-feed?key=${refreshKey}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            alt="Live Camera Feed"
            onError={(e) => (e.target.style.display = 'none')}
          />
          {/* HUD */}
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(0,255,0,0.8)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px'
          }}>
            LIVE CAMERA
          </div>
        </>
      ) : uploadedSrc ? (
        <>
          <img
            src={
              uploadedPlaying
                ? `http://localhost:8000/parking/video-feed?key=${refreshKey}`
                : `http://localhost:8000/parking/snapshot?key=${refreshKey}`
            }
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            alt="Annotated Video Feed"
            onError={(e) => (e.target.style.display = 'none')}
          />
          {/* HUD */}
          <div
            style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              backgroundColor: 'rgba(255,0,0,0.8)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px'
            }}
          >
            PROCESSED VIDEO
          </div>
          {/* Play / Pause / Replay controls for uploaded video */}
          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              display: 'flex',
              gap: '8px'
            }}
          >
            <button
              onClick={() => setUploadedPlaying((p) => !p)}
              style={{
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.5)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              {uploadedPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={() => {
                setRefreshKey(Date.now());
                setUploadedPlaying(true);
              }}
              style={{
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.5)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
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
      {/* Controls - show refresh when camera feed is active */}
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
