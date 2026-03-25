import React, { useRef, useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../lib/api';

const ZONE_COLORS = {
  A: { stroke: '#F59E0B', fill: 'rgba(245,158,11,0.15)', label: 'Zone A – Standard' },
  B: { stroke: '#3498DB', fill: 'rgba(52,152,219,0.15)', label: 'Zone B – Economy' },
  C: { stroke: '#EF4444', fill: 'rgba(239,68,68,0.14)', label: 'Zone C – Premium' },
};

const SlotEditor = () => {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const [polygons, setPolygons] = useState([]);
  const [currentPolygon, setCurrentPolygon] = useState([]);
  const [mode, setMode] = useState('slots');
  const [selectedZone, setSelectedZone] = useState('A');
  const [entryZone, setEntryZone] = useState(null);
  const [exitZone, setExitZone] = useState(null);
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchExistingSlots = async () => {
      try {
        const response = await fetch(apiUrl('/parking/slots'));
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data.polygons)) setPolygons(data.polygons);
        if (Array.isArray(data.entry_zone)) setEntryZone(data.entry_zone);
        if (Array.isArray(data.exit_zone)) setExitZone(data.exit_zone);
      } catch (e) { console.error(e); }
    };
    fetchExistingSlots();
  }, []);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => { setImage(img); drawCanvas(img); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const loadFromCurrentFeed = async () => {
    try {
      const response = await fetch(apiUrl('/parking/snapshot'));
      if (!response.ok) { alert('No active video feed.'); return; }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { setImage(img); drawCanvas(img); URL.revokeObjectURL(url); };
      img.src = url;
    } catch { alert('Error capturing frame.'); }
  };

  const getPoints = (slot) => Array.isArray(slot) ? slot : slot?.points || [];
  const getZone = (slot) => slot?.zone || 'A';

  const fillPolygon = (ctx, points, fillColor) => {
    if (points.length < 3) return;
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
  };

  const drawCanvas = useCallback((img) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    polygons.forEach((slot, idx) => {
      const points = getPoints(slot);
      const zone = getZone(slot);
      const colors = ZONE_COLORS[zone] || ZONE_COLORS.A;
      const isHovered = hoveredSlot === idx;
      if (points.length > 1) {
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.strokeStyle = colors.stroke;
        fillPolygon(ctx, points, colors.fill);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.stroke();
        const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
        const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.fillStyle = colors.stroke;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Z${zone}`, cx, cy);
      }
    });

    if (entryZone?.length > 1) {
      ctx.strokeStyle = '#10B981'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(entryZone[0].x, entryZone[0].y);
      for (let i = 1; i < entryZone.length; i++) ctx.lineTo(entryZone[i].x, entryZone[i].y);
      ctx.closePath(); ctx.stroke();
    }
    if (exitZone?.length > 1) {
      ctx.strokeStyle = '#F43F5E'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(exitZone[0].x, exitZone[0].y);
      for (let i = 1; i < exitZone.length; i++) ctx.lineTo(exitZone[i].x, exitZone[i].y);
      ctx.closePath(); ctx.stroke();
    }
    if (currentPolygon.length > 0) {
      const strokeColor = mode === 'entry' ? '#10B981' : mode === 'exit' ? '#F43F5E' : '#64748B';
      ctx.strokeStyle = strokeColor; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(currentPolygon[0].x, currentPolygon[0].y);
      for (let i = 1; i < currentPolygon.length; i++) ctx.lineTo(currentPolygon[i].x, currentPolygon[i].y);
      ctx.stroke();
      currentPolygon.forEach((p) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = strokeColor; ctx.fill();
      });
    }
  }, [currentPolygon, entryZone, exitZone, hoveredSlot, mode, polygons]);

  useEffect(() => { if (image) drawCanvas(image); }, [drawCanvas, image]);

  const handleCanvasClick = (e) => {
    if (!image) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (currentPolygon.length < 4) setCurrentPolygon([...currentPolygon, { x, y }]);
    if (currentPolygon.length === 3) {
      const completed = [...currentPolygon, { x, y }];
      if (mode === 'entry') setEntryZone(completed);
      else if (mode === 'exit') setExitZone(completed);
      else setPolygons([...polygons, { points: completed, zone: selectedZone }]);
      setCurrentPolygon([]);
    }
  };

  const handleCanvasRightClick = (e) => {
    e.preventDefault();
    if (currentPolygon.length > 2) {
      if (mode === 'entry') setEntryZone(currentPolygon);
      else if (mode === 'exit') setExitZone(currentPolygon);
      else setPolygons([...polygons, { points: currentPolygon, zone: selectedZone }]);
      setCurrentPolygon([]);
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (!image) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    let found = -1;
    polygons.forEach((slot, idx) => {
      const pts = getPoints(slot);
      if (pts.length >= 3 && pointInPoly(x, y, pts)) found = idx;
    });
    setHoveredSlot(found >= 0 ? found : null);
  };

  const pointInPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (((poly[i].y > y) !== (poly[j].y > y)) && (x < (poly[j].x - poly[i].x) * (y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x))
        inside = !inside;
    }
    return inside;
  };

  const handleSave = async () => {
    if (!image) { alert('Load a frame first.'); return; }
    const hasInProgress = currentPolygon.length >= 3;
    const committedPolygons = mode === 'slots' && hasInProgress ? [...polygons, { points: currentPolygon, zone: selectedZone }] : polygons;
    const committedEntryZone = mode === 'entry' && hasInProgress ? currentPolygon : entryZone;
    const committedExitZone = mode === 'exit' && hasInProgress ? currentPolygon : exitZone;
    if (hasInProgress) {
      if (mode === 'entry') setEntryZone(currentPolygon);
      if (mode === 'exit') setExitZone(currentPolygon);
      if (mode === 'slots') setPolygons(committedPolygons);
      setCurrentPolygon([]);
    }
    try {
      const response = await fetch(apiUrl('/update-parking-slots'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parking_slots: committedPolygons, frame_width: image.width, frame_height: image.height, entry_zone: committedEntryZone, exit_zone: committedExitZone }),
      });
      if (response.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
      else alert('Failed to save.');
    } catch { alert('Error saving.'); }
  };

  const handleUndo = () => { if (currentPolygon.length > 0) setCurrentPolygon(currentPolygon.slice(0, -1)); };
  const handleClearCurrent = () => setCurrentPolygon([]);
  const handleClearAll = () => { setPolygons([]); setCurrentPolygon([]); setEntryZone(null); setExitZone(null); };
  const handleDeleteSlot = (idx) => setPolygons(polygons.filter((_, i) => i !== idx));
  const handleChangeSlotZone = (idx, newZone) => setPolygons(polygons.map((s, i) => (i === idx ? { ...s, zone: newZone } : s)));

  const zoneCounts = { A: 0, B: 0, C: 0 };
  polygons.forEach((s) => { const z = getZone(s); if (zoneCounts[z] !== undefined) zoneCounts[z]++; });

  const modeLabel = mode === 'entry' ? 'Drawing Entry Zone' : mode === 'exit' ? 'Drawing Exit Zone' : `Drawing Slot ${polygons.length + 1}`;
  const modeColor = mode === 'entry' ? '#10B981' : mode === 'exit' ? '#F43F5E' : '#64748B';
  const configuredFlowZones = [entryZone, exitZone].filter(Boolean).length;

  return (
    <div className="se-root">
      <div className="se-topbar">
        <div className="se-topbar-main">
          <div className="se-topbar-left">
            <div>
              <h2 className="se-title">Slot Editor</h2>
              <p className="se-subtitle">Define parking polygons, assign zones, and configure entry and exit paths for the live pipeline.</p>
            </div>
          </div>
          <div className="se-topbar-right">
            <div className="se-draw-indicator" style={{ color: modeColor, background: modeColor + '16', borderColor: modeColor + '38' }}>
              <span className="se-draw-pulse" style={{ background: modeColor }} />
              {modeLabel}
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, opacity: 0.72, marginLeft: 6 }}>{currentPolygon.length}/4</span>
            </div>
          </div>
        </div>
      </div>

      <div className="se-metric-strip">
        <div className="glass se-metric-card se-metric-card-accent" style={{ '--accent-color': '#3498DB' }}>
          <span className="se-metric-label">Configured Slots</span>
          <div className="se-metric-value">
            <span className="se-metric-major">{polygons.length}</span>
          </div>
          <span className="se-metric-note">Live polygon count</span>
        </div>
        <div className="glass se-metric-card se-metric-card-accent" style={{ '--accent-color': '#10B981' }}>
          <span className="se-metric-label">Flow Zones</span>
          <div className="se-metric-value">
            <span className="se-metric-major">{configuredFlowZones}</span>
            <span className="se-metric-minor">/2</span>
          </div>
          <span className="se-metric-note">Entry and exit coverage</span>
        </div>
        <div className="glass se-metric-card se-metric-card-accent" style={{ '--accent-color': modeColor }}>
          <span className="se-metric-label">Active Mode</span>
          <div className="se-metric-value">
            <span className="se-metric-major se-metric-major-text">{mode === 'slots' ? `Zone ${selectedZone}` : mode === 'entry' ? 'Entry' : 'Exit'}</span>
          </div>
          <span className="se-metric-note">Current drawing target</span>
        </div>
      </div>

      <div className="se-body">
        {/* Canvas panel */}
        <div className="se-canvas-wrap">
          <div className="se-canvas-toolbar">
            <div className="se-canvas-toolbar-left">
              <button className="se-tool-btn se-tool-btn--primary" onClick={loadFromCurrentFeed}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                Capture Frame
              </button>
              <label className="se-tool-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                Upload Image
                <input type="file" accept="image/*" onChange={handleImageUpload} />
              </label>
            </div>
            <div className="se-canvas-toolbar-right">
              <span className="se-coord-hint" style={{ color: modeColor }}>
                {mode === 'entry' ? 'Entry path' : mode === 'exit' ? 'Exit path' : `Slot zone ${selectedZone}`} · click to place points
              </span>
            </div>
          </div>

          {image ? (
            <div className="se-canvas-area">
              <div className="se-canvas-stage">
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  onContextMenu={handleCanvasRightClick}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseLeave={() => setHoveredSlot(null)}
                />
              </div>
            </div>
          ) : (
            <div className="se-canvas-empty">
              <div className="se-canvas-empty-icon">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="3" />
                  <circle cx="8.5" cy="8.5" r="2.5" />
                  <path d="M21 15l-5-5L5 21" />
                  <path d="M14 3l4 4-4 4" />
                </svg>
              </div>
              <h3>No Frame Loaded</h3>
              <p>Capture a frame from the live video feed or upload a reference image to begin defining parking slots.</p>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="se-panel glass">
          {/* Zones */}
          <div className="se-panel-section">
            <div className="se-panel-header">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
              Zone Classification
            </div>
            <div className="se-zone-list">
              {Object.entries(ZONE_COLORS).map(([key, val]) => (
                <button
                  key={key}
                  className={`se-zone-item ${selectedZone === key ? 'active' : ''}`}
                  style={{ '--zone-c': val.stroke, '--zone-f': val.fill }}
                  onClick={() => setSelectedZone(key)}
                >
                  <span className="se-zone-item-dot" />
                  <span className="se-zone-item-label">{val.label}</span>
                  <span className="se-zone-item-count">{zoneCounts[key]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Flow zones */}
          <div className="se-panel-section">
            <div className="se-panel-header">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
              Flow Zones
            </div>
            <div className="se-flow-pills">
              <button className={`se-flow-pill ${mode === 'slots' ? 'active' : ''}`} style={{ '--pill-c': '#64748B' }} onClick={() => { setMode('slots'); setCurrentPolygon([]); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
                Slots
              </button>
              <button className={`se-flow-pill ${mode === 'entry' ? 'active' : ''}`} style={{ '--pill-c': '#10B981' }} onClick={() => { setMode('entry'); setCurrentPolygon([]); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
                Entry
              </button>
              <button className={`se-flow-pill ${mode === 'exit' ? 'active' : ''}`} style={{ '--pill-c': '#F43F5E' }} onClick={() => { setMode('exit'); setCurrentPolygon([]); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                Exit
              </button>
            </div>
            <p className="se-panel-hint">Entry and exit zones turn the editor into a traffic map, not just a slot painter.</p>
          </div>

          {/* Tools */}
          <div className="se-panel-section">
            <div className="se-panel-header">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
              Tools
            </div>
            <div className="se-tool-stack">
              <button className="se-tool-link" onClick={handleUndo}><span>↩</span> Undo last point</button>
              <button className="se-tool-link" onClick={handleClearCurrent}><span>⊘</span> Clear current</button>
              <button className="se-tool-link se-tool-link--danger" onClick={handleClearAll}><span>✕</span> Clear all</button>
            </div>
          </div>

          {/* Slot list */}
          {polygons.length > 0 && (
            <div className="se-panel-section">
              <div className="se-panel-header">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                Slots ({polygons.length})
              </div>
              <div className="se-slot-grid">
                {polygons.map((slot, idx) => {
                  const z = getZone(slot);
                  const colors = ZONE_COLORS[z] || ZONE_COLORS.A;
                  return (
                    <div key={idx} className={`se-slot-row ${hoveredSlot === idx ? 'hovered' : ''}`} onMouseEnter={() => setHoveredSlot(idx)} onMouseLeave={() => setHoveredSlot(null)}>
                      <div className="se-slot-chip" style={{ '--slot-c': colors.stroke, '--slot-bg': colors.fill }}>
                        <span className="se-slot-chip-dot" />
                        <span className="se-slot-label">S{idx + 1}</span>
                      </div>
                      <select className="se-slot-zone" value={z} onChange={(e) => handleChangeSlotZone(idx, e.target.value)} style={{ borderColor: colors.stroke + '66' }}>
                        <option value="A">Zone A</option>
                        <option value="B">Zone B</option>
                        <option value="C">Zone C</option>
                      </select>
                      <button className="se-slot-del" onClick={() => handleDeleteSlot(idx)} title="Remove">✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Save */}
          <div className="se-save-area">
            <button className={`se-save-btn ${saved ? 'saved' : ''}`} onClick={handleSave}>
              {saved ? (
                <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg> Saved!</>
              ) : (
                <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg> Save Configuration</>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .se-root {
          padding: 24px;
          max-width: 1440px;
          margin: 0 auto;
        }
        .se-topbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
        }
        .se-topbar-main {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          width: 100%;
        }
        .se-topbar-left { max-width: 720px; }
        .se-title {
          margin: 0 0 4px;
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .se-subtitle {
          margin: 0;
          font-size: 14px;
          color: var(--text-muted);
        }
        .se-topbar-right {
          flex-shrink: 0;
        }
        .se-draw-indicator {
          display: flex; align-items: center; gap: 7px;
          min-height: 40px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid;
          font-size: 12px; font-weight: 600;
        }
        .se-draw-pulse { width: 7px; height: 7px; border-radius: 50%; animation: se-pulse 1.5s infinite; }
        @keyframes se-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

        .se-metric-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 24px;
        }
        .se-metric-card {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 16px 20px;
        }
        .se-metric-card-accent::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          border-radius: 12px 12px 0 0;
          background: var(--accent-color);
        }
        .se-metric-label {
          margin-bottom: 4px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          font-weight: 600;
        }
        .se-metric-value {
          display: flex;
          align-items: flex-start;
          gap: 2px;
          color: var(--text-primary);
          line-height: 1;
        }
        .se-metric-major {
          font-size: 34px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.04em;
          font-variant-numeric: tabular-nums;
        }
        .se-metric-major-text {
          font-size: 30px;
          letter-spacing: -0.03em;
        }
        .se-metric-minor {
          margin-top: 6px;
          font-size: 15px;
          font-weight: 600;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .se-metric-value,
        .se-metric-major,
        .se-metric-minor {
          font-family: 'Inter', sans-serif;
        }
        .se-metric-major {
          color: var(--text-primary);
        }
        .se-metric-note {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .se-body { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 18px; align-items: start; }

        .se-canvas-wrap {
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          border-radius: 12px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .se-canvas-toolbar {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 20px; border-bottom: 1px solid var(--panel-border);
          background: transparent;
        }
        .se-canvas-toolbar-left { display: flex; gap: 8px; }
        .se-canvas-toolbar-right { display: flex; gap: 8px; align-items: center; }
        .se-tool-btn {
          display: flex; align-items: center; gap: 6px;
          height: 34px;
          padding: 0 12px; border-radius: 8px;
          border: 1px solid var(--panel-border); background: rgba(255,255,255,0.03);
          color: var(--text-secondary); font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
        }
        .se-tool-btn:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
        .se-tool-btn--primary { background: rgba(52,152,219,0.18); border-color: rgba(52,152,219,0.4); color: var(--text-primary); box-shadow: none; }
        .se-tool-btn--primary:hover { background: rgba(52,152,219,0.24); }
        .se-tool-btn input { display: none; }
        .se-coord-hint { font-size: 11px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }

        .se-canvas-area {
          flex: 1; overflow: auto; min-height: 400px;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          background: rgba(255,255,255,0.02);
        }
        .se-canvas-stage {
          position: relative;
          padding: 12px;
          border-radius: 10px;
          background: rgba(0,0,0,0.18);
          border: 1px solid rgba(255,255,255,0.05);
        }
        .se-canvas-area canvas {
          cursor: crosshair;
          display: block;
          max-width: 100%;
          border-radius: 6px;
          box-shadow: 0 12px 24px rgba(0,0,0,0.24);
        }

        .se-canvas-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 60px 40px; text-align: center; min-height: 400px;
        }
        .se-canvas-empty-icon { color: var(--text-muted); opacity: 0.4; margin-bottom: 16px; }
        .se-canvas-empty h3 { font-size: 16px; font-weight: 600; color: var(--text-secondary); margin: 0 0 8px; }
        .se-canvas-empty p { font-size: 13px; color: var(--text-muted); margin: 0; max-width: 320px; line-height: 1.5; }

        .se-panel {
          border-radius: 12px; padding: 0; overflow: hidden;
          display: flex; flex-direction: column;
          background: var(--panel-bg);
        }
        .se-panel-section {
          padding: 18px 20px; border-bottom: 1px solid var(--panel-border);
        }
        .se-panel-section:last-of-type { border-bottom: none; }
        .se-panel-header {
          display: flex; align-items: center; gap: 7px;
          font-size: 12px; font-weight: 700; color: var(--text-secondary);
          text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 12px;
        }
        .se-panel-hint {
          font-size: 11px;
          color: var(--text-muted);
          margin: 10px 0 0;
          line-height: 1.6;
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .se-zone-list { display: flex; flex-direction: column; gap: 8px; }
        .se-zone-item {
          display: flex; align-items: center; gap: 8px;
          min-height: 56px;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.025);
          color: var(--text-primary); cursor: pointer;
          font-size: 13px; font-weight: 500; transition: all 0.15s; text-align: left;
        }
        .se-zone-item:hover {
          border-color: var(--zone-c);
          background: linear-gradient(180deg, var(--zone-f), rgba(255,255,255,0.02));
        }
        .se-zone-item.active {
          border-color: var(--zone-c);
          background: linear-gradient(180deg, var(--zone-f), rgba(255,255,255,0.02));
          font-weight: 700;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
        }
        .se-zone-item-dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: var(--zone-c); flex-shrink: 0;
          transition: transform 0.15s;
        }
        .se-zone-item.active .se-zone-item-dot { transform: scale(1.3); }
        .se-zone-item-label { flex: 1; }
        .se-zone-item-count {
          min-width: 32px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: 'JetBrains Mono', monospace; font-size: 11px;
          font-weight: 700; color: var(--zone-c); background: rgba(0,0,0,0.18);
          padding: 0 8px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.06);
        }

        .se-flow-pills {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .se-flow-pill {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
          min-height: 42px;
          padding: 9px 10px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.025);
          color: var(--text-secondary); cursor: pointer;
          font-size: 12px; font-weight: 600; transition: all 0.15s;
        }
        .se-flow-pill:hover { background: rgba(255,255,255,0.05); border-color: var(--pill-c); color: var(--pill-c); }
        .se-flow-pill.active { background: var(--pill-c); color: #fff; border-color: var(--pill-c); }

        .se-tool-stack { display: flex; flex-direction: column; gap: 8px; }
        .se-tool-link {
          display: flex; align-items: center; gap: 8px;
          min-height: 42px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02);
          color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: all 0.15s;
          text-align: left;
        }
        .se-tool-link:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
          color: var(--text-primary);
        }
        .se-tool-link span {
          width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 7px;
          background: rgba(255,255,255,0.06);
          font-size: 13px;
          text-align: center;
          flex-shrink: 0;
        }
        .se-tool-link--danger:hover { background: rgba(239,68,68,0.1); color: var(--red); border-color: rgba(239,68,68,0.2); }

        .se-slot-grid { display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; }
        .se-slot-row {
          display: flex; align-items: center; gap: 6px;
          min-height: 48px;
          padding: 8px 10px;
          border-radius: 10px;
          transition: background 0.15s;
          border: 1px solid rgba(255,255,255,0.05);
          background: rgba(255,255,255,0.02);
        }
        .se-slot-row:hover, .se-slot-row.hovered { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
        .se-slot-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 68px;
          height: 32px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.06);
          background: linear-gradient(180deg, var(--slot-bg), rgba(255,255,255,0.02));
          flex-shrink: 0;
        }
        .se-slot-chip-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--slot-c);
          box-shadow: 0 0 0 3px rgba(255,255,255,0.03);
        }
        .se-slot-label {
          font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 800;
          color: var(--slot-c);
        }
        .se-slot-zone {
          flex: 1; min-height: 32px; padding: 6px 10px; border-radius: 8px;
          border: 1px solid var(--panel-border); background: rgba(0,0,0,0.28);
          color: var(--text-primary); font-size: 11px; cursor: pointer; outline: none;
        }
        .se-slot-del {
          width: 28px; height: 28px; border-radius: 8px; border: none;
          background: transparent; color: var(--text-muted); cursor: pointer;
          font-size: 11px; display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .se-slot-del:hover { background: rgba(239,68,68,0.15); color: var(--red); }

        .se-save-area {
          padding: 18px 20px 20px;
          margin-top: auto;
          background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0));
        }
        .se-save-btn {
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
          min-height: 46px;
          padding: 13px 16px; border-radius: 12px; border: none;
          background: linear-gradient(135deg, #2ECC71, #27AE60);
          color: #fff; font-size: 14px; font-weight: 700; cursor: pointer;
          transition: all 0.2s; box-shadow: 0 4px 12px rgba(16,185,129,0.3);
        }
        .se-save-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16,185,129,0.4); }
        .se-save-btn:active { transform: translateY(0); }
        .se-save-btn.saved { background: linear-gradient(135deg, #3B82F6, #6366F1); box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
        .se-save-hint { font-size: 11px; color: var(--text-muted); margin: 8px 0 0; text-align: center; }
        .se-save-hint code {
          font-family: 'JetBrains Mono', monospace; font-size: 10px;
          background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px;
        }

        @media (max-width: 900px) {
          .se-body { grid-template-columns: 1fr; }
          .se-topbar-main { flex-direction: column; }
          .se-metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .se-canvas-toolbar { flex-direction: column; align-items: flex-start; gap: 10px; }
          .se-canvas-toolbar-left { flex-wrap: wrap; }
          .se-flow-pills { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .se-root { padding: 20px 14px; }
          .se-title { font-size: 22px; }
          .se-metric-strip { grid-template-columns: 1fr; }
          .se-canvas-area { padding: 12px; min-height: 320px; }
          .se-canvas-stage { padding: 10px; }
        }
      `}</style>
    </div>
  );
};

export default SlotEditor;
