import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';

const LiveFeed = ({ uploadedSrc, cameraOn }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [stream, setStream] = useState(null);
  const [annotatedUrl, setAnnotatedUrl] = useState('');

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/parking-updates');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.annotated_url) {
        setAnnotatedUrl(data.annotated_url);
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (annotatedUrl) {
      if (videoRef.current) {
        videoRef.current.src = `http://localhost:8000${annotatedUrl}`;
        videoRef.current.srcObject = null;
        videoRef.current.load();
        videoRef.current.play().then(() => setIsPlaying(true)).catch(e => console.error('Play failed', e));
      }
    }
  }, [annotatedUrl]);

  useEffect(() => {
    if (uploadedSrc) {
      if (videoRef.current) {
        videoRef.current.src = `http://localhost:8000${uploadedSrc}`;
        videoRef.current.srcObject = null;
        videoRef.current.load();
        videoRef.current.play().then(() => setIsPlaying(true)).catch(e => console.error('Play failed', e));
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
    } else if (cameraOn) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [uploadedSrc, cameraOn]);

  useEffect(() => {
    if (!cameraOn) {
      stopCamera();
    }
  }, [cameraOn]); // eslint-disable-next-line react-hooks/exhaustive-deps

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.src = null;
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('Error starting camera', err);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const restart = () => {
    if (uploadedSrc) {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play();
        setIsPlaying(true);
      }
    } else {
      stopCamera();
      startCamera();
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
      <video
        ref={videoRef}
        autoPlay={isPlaying}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {/* HUD */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        backgroundColor: 'rgba(255,0,0,0.8)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '12px'
      }}>
        {uploadedSrc ? 'VIDEO' : cameraOn ? 'LIVE' : 'OFF'}
      </div>
      {/* Controls */}
      <div style={{ position: 'absolute', bottom: '10px', left: '10px', display: 'flex', gap: '8px' }}>
        <button onClick={togglePlayPause} style={{ padding: '6px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '4px' }}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={restart} style={{ padding: '6px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '4px' }}>
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
};

export default LiveFeed;
