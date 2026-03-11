import React, { useRef, useState, useEffect } from 'react';

const SlotEditor = () => {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const [polygons, setPolygons] = useState([]);
  const [currentPolygon, setCurrentPolygon] = useState([]);
  const [mode, setMode] = useState('slots'); // 'slots' | 'entry' | 'exit'
  const [entryZone, setEntryZone] = useState(null);
  const [exitZone, setExitZone] = useState(null);

  // Load existing parking slots on mount
  useEffect(() => {
    const fetchExistingSlots = async () => {
      try {
        const response = await fetch('http://localhost:8000/parking/slots');
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data.polygons)) {
          setPolygons(data.polygons);
        }
        if (Array.isArray(data.entry_zone)) {
          setEntryZone(data.entry_zone);
        }
        if (Array.isArray(data.exit_zone)) {
          setExitZone(data.exit_zone);
        }
      } catch (e) {
        console.error('Failed to load existing slots', e);
      }
    };
    fetchExistingSlots();
  }, []);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setImage(img);
          drawCanvas(img);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const loadFromCurrentFeed = async () => {
    try {
      const response = await fetch('http://localhost:8000/parking/snapshot');
      if (!response.ok) {
        alert('No active video feed or failed to capture frame.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        setImage(img);
        drawCanvas(img);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (error) {
      console.error('Snapshot error:', error);
      alert('Error capturing frame from current feed.');
    }
  };

  const drawCanvas = (img) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    ctx.lineWidth = 2;

    // Draw parking slots in red
    ctx.strokeStyle = 'red';
    polygons.forEach(polygon => {
      if (polygon.length > 1) {
        ctx.beginPath();
        ctx.moveTo(polygon[0].x, polygon[0].y);
        for (let i = 1; i < polygon.length; i++) {
          ctx.lineTo(polygon[i].x, polygon[i].y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    });

    // Draw global entry zone in green
    if (entryZone && entryZone.length > 1) {
      ctx.strokeStyle = 'lime';
      ctx.beginPath();
      ctx.moveTo(entryZone[0].x, entryZone[0].y);
      for (let i = 1; i < entryZone.length; i++) {
        ctx.lineTo(entryZone[i].x, entryZone[i].y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Draw global exit zone in blue
    if (exitZone && exitZone.length > 1) {
      ctx.strokeStyle = 'deepskyblue';
      ctx.beginPath();
      ctx.moveTo(exitZone[0].x, exitZone[0].y);
      for (let i = 1; i < exitZone.length; i++) {
        ctx.lineTo(exitZone[i].x, exitZone[i].y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Draw current polygon for whichever mode is active
    if (currentPolygon.length > 0) {
      ctx.strokeStyle = mode === 'entry' ? 'lime' : mode === 'exit' ? 'deepskyblue' : 'red';
      ctx.beginPath();
      ctx.moveTo(currentPolygon[0].x, currentPolygon[0].y);
      for (let i = 1; i < currentPolygon.length; i++) {
        ctx.lineTo(currentPolygon[i].x, currentPolygon[i].y);
      }
      ctx.stroke();
    }
  };

  useEffect(() => {
    if (image) {
      drawCanvas(image);
    }
  }, [polygons, currentPolygon, image]);

  const handleCanvasClick = (e) => {
    if (!image) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const maxPoints = 4;

    if (currentPolygon.length < maxPoints) {
      setCurrentPolygon([...currentPolygon, { x, y }]);
    }
    if (currentPolygon.length === maxPoints - 1) {
      const completed = [...currentPolygon, { x, y }];
      if (mode === 'entry') {
        setEntryZone(completed);
      } else if (mode === 'exit') {
        setExitZone(completed);
      } else {
        setPolygons([...polygons, completed]);
      }
      setCurrentPolygon([]);
    }
  };

  const handleCanvasRightClick = (e) => {
    e.preventDefault();
    if (currentPolygon.length > 2) {
      if (mode === 'entry') {
        setEntryZone(currentPolygon);
      } else if (mode === 'exit') {
        setExitZone(currentPolygon);
      } else {
        setPolygons([...polygons, currentPolygon]);
      }
      setCurrentPolygon([]);
    }
  };

  const handleSave = async () => {
    if (!image) {
      alert('Please load a frame or image before saving slots.');
      return;
    }

    // Build payload synchronously (don't rely on async setState)
    const hasInProgress = currentPolygon.length >= 3;
    const committedPolygons =
      mode === 'slots' && hasInProgress ? [...polygons, currentPolygon] : polygons;
    const committedEntryZone =
      mode === 'entry' && hasInProgress ? currentPolygon : entryZone;
    const committedExitZone =
      mode === 'exit' && hasInProgress ? currentPolygon : exitZone;

    const data = { 
      parking_slots: committedPolygons,
      frame_width: image.width,
      frame_height: image.height,
      entry_zone: committedEntryZone,
      exit_zone: committedExitZone
    };

    // Now update local state to reflect what we saved
    if (hasInProgress) {
      if (mode === 'entry') setEntryZone(currentPolygon);
      if (mode === 'exit') setExitZone(currentPolygon);
      if (mode === 'slots') setPolygons(committedPolygons);
      setCurrentPolygon([]);
    }
    try {
      const response = await fetch('http://localhost:8000/update-parking-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (response.ok) {
        alert('Parking slots saved successfully!');
      } else {
        alert('Failed to save parking slots.');
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Error saving parking slots.');
    }
  };

  const handleUndo = () => {
    if (currentPolygon.length > 0) {
      setCurrentPolygon(currentPolygon.slice(0, -1));
    }
  };

  const handleClearCurrent = () => {
    setCurrentPolygon([]);
  };

  const handleClearAll = () => {
    setPolygons([]);
    setCurrentPolygon([]);
    setEntryZone(null);
    setExitZone(null);
  };

  return (
    <div style={{ padding: '100px 30px 30px 30px', maxWidth: '1400px', margin: '0 auto' }}>
      <div className="glass" style={{ padding: '20px 24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Parking Slot Editor</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Draw 4-point polygons over a snapshot from the live feed or an uploaded reference image.
          </p>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Current slot: {currentPolygon.length}/4 • Total slots: {polygons.length}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--gap)' }}>
        <div className="glass" style={{ padding: '16px', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-blue"
              onClick={loadFromCurrentFeed}
              style={{ padding: '8px 14px' }}
            >
              Use current video frame
            </button>
            <label
              className="btn btn-ghost"
              style={{ padding: '8px 14px', cursor: 'pointer' }}
            >
              Upload reference image
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          {image ? (
            <div style={{ flex: 1, overflow: 'auto', borderRadius: '8px', border: '1px solid var(--panel-border)', backgroundColor: 'var(--panel-bg)' }}>
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onContextMenu={handleCanvasRightClick}
                style={{ cursor: 'crosshair', display: 'block', maxWidth: '100%' }}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
              Capture a frame from the live feed or upload a reference image to begin annotating slots.
            </div>
          )}
        </div>

        <div className="glass" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Editing tools
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="btn btn-ghost" onClick={handleUndo}>Undo last point</button>
              <button className="btn btn-ghost" onClick={handleClearCurrent}>Clear current slot</button>
              <button className="btn btn-ghost" onClick={handleClearAll}>Clear all slots</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Flow zones (for revenue and analytics)
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                className={`btn btn-ghost ${mode === 'slots' ? 'btn-blue' : ''}`}
                onClick={() => { setMode('slots'); setCurrentPolygon([]); }}
              >
                Edit slots
              </button>
              <button
                className={`btn btn-ghost ${mode === 'entry' ? 'btn-blue' : ''}`}
                onClick={() => { setMode('entry'); setCurrentPolygon([]); }}
              >
                Entry zone
              </button>
              <button
                className={`btn btn-ghost ${mode === 'exit' ? 'btn-blue' : ''}`}
                onClick={() => { setMode('exit'); setCurrentPolygon([]); }}
              >
                Exit zone
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Use entry/exit zones to help the backend compute dwell time and revenue as vehicles cross into and out of the lot.
            </p>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Save configuration
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Saved slots are written to `parking_slots.json` and used by the backend YOLO pipeline for occupancy detection.
            </p>
            <button className="btn btn-green" onClick={handleSave} style={{ width: '100%' }}>
              Save slots
            </button>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.6 }}>
            • Click four points in order to define each parking slot polygon. <br />
            • Right-click to close a polygon early. <br />
            • Use consistent zoom so annotations match the live feed.
          </div>
        </div>
      </div>
    </div>
  );
};

export default SlotEditor;
