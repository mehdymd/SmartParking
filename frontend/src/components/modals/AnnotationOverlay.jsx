import React, { useState, useRef, useEffect } from 'react';

const AnnotationOverlay = ({ isOpen, onClose }) => {
  const [polygons, setPolygons] = useState([]);
  const [currentPolygon, setCurrentPolygon] = useState([]);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      const canvas = canvasRef.current;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw();
    }
  }, [polygons, currentPolygon]);

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw completed polygons
    polygons.forEach((poly, index) => {
      ctx.fillStyle = 'rgba(52,152,219,0.4)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      poly.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Label
      const cx = poly.reduce((sum, [x]) => sum + x, 0) / poly.length;
      const cy = poly.reduce((sum, [, y]) => sum + y, 0) / poly.length;
      ctx.fillStyle = '#fff';
      ctx.fillText(index + 1, cx, cy);
    });

    // Draw current polygon
    if (currentPolygon.length > 0) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      currentPolygon.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  };

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCurrentPolygon([...currentPolygon, [x, y]]);
  };

  const handleDoubleClick = () => {
    if (currentPolygon.length > 2) {
      setPolygons([...polygons, currentPolygon]);
      setCurrentPolygon([]);
    }
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    setCurrentPolygon([]);
  };

  const clearAll = () => {
    setPolygons([]);
    setCurrentPolygon([]);
  };

  const undo = () => {
    if (currentPolygon.length > 0) {
      setCurrentPolygon(currentPolygon.slice(0, -1));
    } else if (polygons.length > 0) {
      setPolygons(polygons.slice(0, -1));
    }
  };

  const saveSlots = async () => {
    const data = { parking_slots: polygons };
    await fetch('http://localhost:8000/update-parking-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      zIndex: 1500,
      cursor: 'crosshair'
    }}>
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '16px',
        zIndex: 1600
      }}>
        <span style={{ color: '#fff', fontSize: '14px' }}>Polygon Mode</span>
        <button className="btn btn-ghost" onClick={clearAll}>Clear All</button>
        <button className="btn btn-ghost" onClick={undo}>Undo</button>
        <button className="btn btn-blue" onClick={saveSlots}>Save Slots</button>
        <button className="btn btn-red" onClick={onClose}>Exit</button>
      </div>

      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
        onClick={handleCanvasClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleRightClick}
      />

      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        color: '#fff',
        fontSize: '12px',
        textAlign: 'center'
      }}>
        Click to add points • Double-click to complete • Right-click to cancel
      </div>
    </div>
  );
};

export default AnnotationOverlay;
