from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import cv2
import os
import json
import numpy as np
from datetime import datetime
from ultralytics import solutions
from backend.api import app as api_app
from backend.database import (
    create_tables,
    initialize_slots,
    SessionLocal,
    update_slot_status,
    Transaction,
    ParkingSession,
    OccupancyHistory,
)
from backend.config import Config
from backend.parking_logic import get_parking_statistics

status = {}  # slot_id -> 'occupied' | 'available'
reload_flag = False
annotated_url = None

# In-memory tracking for simple billing based on slot occupancy changes
slot_last_state = {}   # slot_id -> last status
slot_entry_time = {}   # slot_id -> datetime of last occupied transition

# Simple centroid tracker for entry/exit transactions
track_next_id = 1
tracks = {}  # id -> {"centroid": (x,y), "last_seen": ts, "has_entered": bool, "entered_at": datetime|None, "tx_open": bool}


def point_in_polygon(point, polygon):
    """Ray casting algorithm. polygon is list of [x,y] floats."""
    if not polygon or len(polygon) < 3:
        return False
    x, y = point
    inside = False
    n = len(polygon)
    x1, y1 = polygon[0]
    for i in range(1, n + 1):
        x2, y2 = polygon[i % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1):
            inside = not inside
        x1, y1 = x2, y2
    return inside


def assign_tracks(detection_centroids, now_ts, max_dist=60.0):
    """Greedy nearest-neighbor assignment. Returns list of (track_id, centroid)."""
    global track_next_id, tracks
    assignments = []
    used_tracks = set()

    # Build list of candidate pairs (dist, track_id, det_idx)
    candidates = []
    for tid, tinfo in tracks.items():
        tx, ty = tinfo["centroid"]
        for i, (dx, dy) in enumerate(detection_centroids):
            dist = float(np.hypot(dx - tx, dy - ty))
            candidates.append((dist, tid, i))
    candidates.sort(key=lambda x: x[0])

    used_det = set()
    for dist, tid, i in candidates:
        if dist > max_dist:
            break
        if tid in used_tracks or i in used_det:
            continue
        used_tracks.add(tid)
        used_det.add(i)
        assignments.append((tid, detection_centroids[i]))

    # Update matched tracks
    for tid, (cx, cy) in assignments:
        tracks[tid]["centroid"] = (cx, cy)
        tracks[tid]["last_seen"] = now_ts

    # Create new tracks for unmatched detections
    for i, (cx, cy) in enumerate(detection_centroids):
        if i in used_det:
            continue
        tid = track_next_id
        track_next_id += 1
        tracks[tid] = {
            "centroid": (cx, cy),
            "last_seen": now_ts,
            "has_entered": False,
            "entered_at": None,
            "tx_open": False,
        }
        assignments.append((tid, (cx, cy)))

    # Prune stale tracks
    stale = [tid for tid, tinfo in tracks.items() if (now_ts - tinfo["last_seen"]) > 3.0]
    for tid in stale:
        # If a transaction is open and we lose the track, we keep it open; it can be closed later by exit crossing.
        del tracks[tid]

    return assignments

# Share latest processed frame with API for live feed
api_app.state.latest_jpeg = None
api_app.state.latest_jpeg_ts = 0.0
api_app.state.latest_raw_jpeg = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_tables()

    # Ensure slots files exist (prevents noisy FileNotFoundError spam)
    try:
        os.makedirs(Config.SLOTS_DIR, exist_ok=True)
        if not os.path.exists(Config.PARKING_SLOTS_JSON):
            with open(Config.PARKING_SLOTS_JSON, "w") as f:
                json.dump({"parking_areas": []}, f)
        if not os.path.exists(Config.PARKING_SLOTS_JSON_WEBCAM):
            with open(Config.PARKING_SLOTS_JSON_WEBCAM, "w") as f:
                json.dump({"parking_areas": []}, f)
    except Exception as e:
        print(f"Error ensuring slots files: {e}")
    db = SessionLocal()
    try:
        # Clear all existing slots to start with no data
        from database import ParkingSlot
        db.query(ParkingSlot).delete()
        db.commit()
    except Exception as e:
        print(f"Error clearing slots: {e}")
    finally:
        db.close()

    # Load YOLO model ONCE at startup (shared via app.state)
    try:
        from ultralytics import YOLO
        app.state.model = YOLO("yolov8n.pt")
    except Exception as e:
        print(f"Error loading YOLO model: {e}")
        app.state.model = None
    
    # Start background video processing task
    video_task = asyncio.create_task(process_video())
    
    yield
    
    # Shutdown
    if video_task:
        video_task.cancel()
        try:
            await video_task
        except asyncio.CancelledError:
            pass

app = FastAPI(title="Smart Parking Management System", lifespan=lifespan)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for videos
app.mount("/videos", StaticFiles(directory="videos"), name="videos")

@app.websocket("/ws/parking-updates")
async def websocket_endpoint(websocket: WebSocket):
    global status
    await websocket.accept()
    last_alert_sent_ts = 0.0
    try:
        while True:
            stats = get_parking_statistics(status)
            await websocket.send_json(
                {
                    "type": "update",
                    "status": status,
                    "stats": stats,
                    "timestamp": "current",
                }
            )

            # Alert broadcast (special message type).
            try:
                now_ts = datetime.utcnow().timestamp()
                if stats.get("occupancy_rate", 0) > Config.ALERT_THRESHOLD and (now_ts - last_alert_sent_ts) > 10.0:
                    last_alert_sent_ts = now_ts
                    await websocket.send_json(
                        {
                            "type": "alert",
                            "message": "Parking lot is almost full!",
                            "occupancy_rate": stats.get("occupancy_rate"),
                            "threshold": Config.ALERT_THRESHOLD,
                        }
                    )
            except Exception:
                pass
            await asyncio.sleep(1)
    except Exception:
        pass

# Include API routes
app.include_router(api_app.router)

async def process_video():
    """
    Background task to process video stream and update parking status using Ultralytics ParkingManagement.
    """
    # Shared state for API endpoints (camera status + latest frame already stored on api_app.state)
    api_app.state.camera_open = False
    api_app.state.camera_last_read_ok = False
    api_app.state.camera_source = None

    # Use startup-loaded YOLO model.
    model = getattr(app.state, "model", None)
    # COCO vehicle classes requested: car=2, bus=5, truck=7
    vehicle_classes = [2, 5, 7]

    def _slots_path_for_source(source):
        if source == 0 or source == "0":
            return Config.PARKING_SLOTS_JSON_WEBCAM
        return Config.PARKING_SLOTS_JSON

    # Cache slot JSON (reload on mtime changes)
    slots_cache = {
        "mtime": None,
        "path": None,
        "raw": {},
        "parking_areas": [],
        "entry_zone": None,
        "exit_zone": None,
        "frame_width": None,
        "frame_height": None,
    }

    def _load_slots_json(path: str):
        try:
            # If the path changed (e.g. webcam vs uploaded), force reload.
            if slots_cache["path"] != path:
                slots_cache["mtime"] = None
                slots_cache["path"] = path
            if not os.path.exists(path):
                # Missing file is valid (no slots defined yet).
                slots_cache["mtime"] = None
                slots_cache["raw"] = {}
                slots_cache["parking_areas"] = []
                slots_cache["entry_zone"] = None
                slots_cache["exit_zone"] = None
                slots_cache["frame_width"] = None
                slots_cache["frame_height"] = None
                return
            mtime = os.path.getmtime(path)
            if slots_cache["mtime"] == mtime:
                return
            with open(path, "r") as f:
                raw = json.load(f)
            slots_cache["mtime"] = mtime
            slots_cache["raw"] = raw
            slots_cache["parking_areas"] = raw.get("parking_areas", []) or []
            slots_cache["entry_zone"] = raw.get("entry_zone")
            slots_cache["exit_zone"] = raw.get("exit_zone")
            slots_cache["frame_width"] = raw.get("frame_width")
            slots_cache["frame_height"] = raw.get("frame_height")
        except Exception as e:
            # Keep previous cache; log once per change at most.
            print(f"Error loading parking slots: {e}")

    def _scale_points(points, scale_x: float, scale_y: float):
        scaled = []
        for p in points or []:
            if isinstance(p, dict):
                x, y = p.get("x", 0), p.get("y", 0)
            else:
                x, y = p[0], p[1]
            scaled.append([float(x) * scale_x, float(y) * scale_y])
        return scaled

    def _build_slot_bboxes(frame_w: int, frame_h: int, slots_path: str):
        _load_slots_json(slots_path)
        fw = slots_cache.get("frame_width") or frame_w
        fh = slots_cache.get("frame_height") or frame_h
        try:
            scale_x = float(frame_w) / float(fw or 1)
            scale_y = float(frame_h) / float(fh or 1)
        except Exception:
            scale_x = scale_y = 1.0

        slot_bboxes_local = {}
        slot_polygons_local = {}
        for idx, area in enumerate(slots_cache.get("parking_areas") or []):
            scaled_area = _scale_points(area, scale_x, scale_y)
            if not scaled_area:
                continue
            xs = [p[0] for p in scaled_area]
            ys = [p[1] for p in scaled_area]
            x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
            slot_id = f"S{idx+1}"
            slot_bboxes_local[slot_id] = [x1, y1, x2, y2]
            slot_polygons_local[slot_id] = scaled_area

        scaled_entry = _scale_points(slots_cache.get("entry_zone"), scale_x, scale_y) if slots_cache.get("entry_zone") else None
        scaled_exit = _scale_points(slots_cache.get("exit_zone"), scale_x, scale_y) if slots_cache.get("exit_zone") else None
        return slot_bboxes_local, slot_polygons_local, scaled_entry, scaled_exit

    def _annotate_frame(frame, slot_bboxes_local, occupancy_map, detections_local):
        annotated = frame.copy()

        # Draw vehicle boxes first.
        for det in detections_local or []:
            try:
                x1, y1, x2, y2 = det["bbox"]
                cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), (255, 255, 0), 2)
            except Exception:
                continue

        # Draw slots (rectangles + id + status label).
        for slot_id, (x1, y1, x2, y2) in (slot_bboxes_local or {}).items():
            state = (occupancy_map or {}).get(slot_id, "available")
            color = (0, 0, 255) if state == "occupied" else (0, 255, 0)
            cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            label = f"{slot_id} {state}"
            cv2.putText(
                annotated,
                label,
                (int(x1), max(0, int(y1) - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
            )
        return annotated

    while True:
        if Config.VIDEO_SOURCE is None or Config.VIDEO_SOURCE == "":
            await asyncio.sleep(1)
            continue
        
        current_source = Config.VIDEO_SOURCE
        api_app.state.camera_source = current_source

        # Image sources: keep a static frame and loop.
        is_image_source = isinstance(current_source, str) and current_source.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp"))
        static_frame = None
        cap = None
        try:
            if is_image_source:
                static_frame = cv2.imread(current_source)
                if static_frame is None:
                    raise RuntimeError(f"Image source {current_source} could not be read")
                api_app.state.camera_open = True
            else:
                try:
                    cap = cv2.VideoCapture(current_source)
                except Exception as e:
                    print(f"Camera source {current_source} could not be opened: {e}")
                    await asyncio.sleep(5)
                    continue
                if not cap.isOpened():
                    print(f"Camera source {current_source} could not be opened")
                    await asyncio.sleep(5)
                    continue
                api_app.state.camera_open = True
        except Exception as e:
            api_app.state.camera_open = False
            print(f"Error opening source {current_source}: {e}")
            await asyncio.sleep(5)
            continue
        
        if current_source != 0:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            if static_frame is not None:
                height, width = int(static_frame.shape[0]), int(static_frame.shape[1])
            else:
                height, width = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            out = cv2.VideoWriter(f'videos/annotated_{os.path.basename(current_source)}', fourcc, 30, (width, height))
            annotated_url = f'/videos/annotated_{os.path.basename(current_source)}'
        else:
            out = None
            annotated_url = None
        
        # Initialize ParkingManagement (currently used for drawing/solutions features)
        # parkingmanager = solutions.ParkingManagement(
        #     model=Config.YOLO_MODEL_PATH,
        #     json_file=Config.PARKING_SLOTS_JSON
        # )
        
        frame_count = 0
        # Cached results to keep stream smooth.
        last_detections = []
        last_occupancy = {}
        # Slots (bbox) rebuilt when source resolution changes or slot config reloads.
        slot_bboxes = {}
        slot_polygons = {}
        scaled_entry = None
        scaled_exit = None
        last_slots_mtime_built = None
        last_infer_ts = 0.0

        while True:
            # Check if source changed
            if Config.VIDEO_SOURCE != current_source:
                current_source = Config.VIDEO_SOURCE
                api_app.state.camera_source = current_source
                is_image_source = isinstance(current_source, str) and current_source.lower().endswith((".jpg", ".jpeg", ".png", ".bmp", ".webp"))
                static_frame = None
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                    cap = None
                try:
                    if is_image_source:
                        static_frame = cv2.imread(current_source)
                        if static_frame is None:
                            raise RuntimeError(f"Image source {current_source} could not be read")
                        api_app.state.camera_open = True
                    else:
                        try:
                            cap = cv2.VideoCapture(current_source)
                        except Exception as e:
                            print(f"Camera source {current_source} could not be opened: {e}")
                            api_app.state.camera_open = False
                            break
                        if not cap.isOpened():
                            print(f"Camera source {current_source} could not be opened")
                            api_app.state.camera_open = False
                            break
                        api_app.state.camera_open = True
                except Exception as e:
                    print(f"Error switching to source {current_source}: {e}")
                    api_app.state.camera_open = False
                    break
                frame_count = 0  # Reset frame count
                last_detections = []
                last_occupancy = {}
                slot_bboxes = {}
                scaled_entry = None
                scaled_exit = None
            
            if static_frame is not None:
                frame = static_frame.copy()
                ret = True
            else:
                ret, frame = cap.read()
            api_app.state.camera_last_read_ok = bool(ret)
            if not ret:
                # Loop playback for file-based sources; break for live sources.
                if isinstance(current_source, str) and not current_source.startswith("http") and not current_source.startswith("/dev/"):
                    try:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    except Exception:
                        pass
                break
            
            frame_count += 1
            # Reload slot config immediately when JSON changes and rebuild bboxes.
            try:
                slots_path = _slots_path_for_source(current_source)
                _load_slots_json(slots_path)
                if last_slots_mtime_built != slots_cache.get("mtime"):
                    h, w = frame.shape[0], frame.shape[1]
                    slot_bboxes, slot_polygons, scaled_entry, scaled_exit = _build_slot_bboxes(w, h, slots_path)
                    last_slots_mtime_built = slots_cache.get("mtime")
            except Exception:
                pass

            # Run inference every frame for correctness (no carry-over states).
            now_ts = datetime.utcnow().timestamp()
            run_infer = True
            detections = last_detections
            det_centroids = []
            if run_infer and model is not None:
                try:
                    last_infer_ts = now_ts
                    # YOLO expects RGB for best results
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    results = model(
                        frame_rgb,
                        conf=0.3,
                        verbose=False,
                    )
                    detections = []
                    det_centroids = []
                    if results and len(results) > 0:
                        for box in results[0].boxes:
                            try:
                                if int(box.cls[0]) not in vehicle_classes:
                                    continue
                                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                                detections.append({"bbox": [float(x1), float(y1), float(x2), float(y2)]})
                                det_centroids.append((float((x1 + x2) / 2.0), float((y1 + y2) / 2.0)))
                            except Exception:
                                continue
                    last_detections = detections
                except Exception as e:
                    print(f"YOLO inference error: {e}")

            # Entry/Exit based transactions (preferred when zones exist)
            if scaled_entry and scaled_exit and det_centroids:
                try:
                    now = datetime.utcnow()
                    now_ts = now.timestamp()
                    assigned = assign_tracks(det_centroids, now_ts)

                    db = SessionLocal()
                    rate_per_hour = 2.0
                    for tid, (cx, cy) in assigned:
                        tinfo = tracks.get(tid)
                        if not tinfo:
                            continue

                        in_entry = point_in_polygon((cx, cy), scaled_entry)
                        in_exit = point_in_polygon((cx, cy), scaled_exit)

                        # Mark entered once we see the track in entry zone
                        if in_entry and not tinfo["has_entered"]:
                            tinfo["has_entered"] = True
                            tinfo["entered_at"] = now

                            tx = Transaction(
                                plate=f"veh-{tid}",
                                slot_id=None,
                                entry_time=now,
                                status="open",
                            )
                            db.add(tx)
                            db.commit()
                            tinfo["tx_open"] = True

                        # Close transaction once vehicle reaches exit zone after entering
                        if in_exit and tinfo["has_entered"] and tinfo["tx_open"]:
                            started = tinfo.get("entered_at") or now
                            minutes = int((now - started).total_seconds() / 60)
                            amount = round(rate_per_hour * (minutes / 60.0), 2)

                            tx = (
                                db.query(Transaction)
                                .filter(Transaction.plate == f"veh-{tid}", Transaction.status == "open")
                                .order_by(Transaction.entry_time.desc())
                                .first()
                            )
                            if tx:
                                tx.exit_time = now
                                tx.duration_mins = minutes
                                tx.amount = amount
                                tx.status = "completed"
                                db.commit()
                            tinfo["tx_open"] = False
                except Exception as e:
                    print(f"Error in entry/exit transactions: {e}")
                finally:
                    try:
                        db.close()
                    except Exception:
                        pass
            
            # Update occupancy each frame (reset to available, then mark occupied by centroid-in-slot-bbox).
            if run_infer and slot_bboxes:
                try:
                    # 1) Reset all slots to available at the start of every frame.
                    occupancy = {slot_id: "available" for slot_id in slot_bboxes.keys()}

                    # 2) Mark occupied if a vehicle centroid is inside the slot bbox.
                    for det in detections:
                        x1, y1, x2, y2 = det["bbox"]
                        cx = int((x1 + x2) // 2)
                        cy = int((y1 + y2) // 2)
                        for slot_id, (sx1, sy1, sx2, sy2) in slot_bboxes.items():
                            if sx1 < cx < sx2 and sy1 < cy < sy2:
                                occupancy[slot_id] = "occupied"

                    last_occupancy = occupancy

                    now = datetime.utcnow()
                    db = SessionLocal()
                    # Store occupancy rate history for charts
                    try:
                        stats_now = get_parking_statistics(occupancy)
                        db.add(OccupancyHistory(timestamp=now, occupancy_rate=float(stats_now.get("occupancy_rate", 0.0))))
                        db.commit()
                    except Exception:
                        db.rollback()
                    for slot_id, state in occupancy.items():
                        prev = slot_last_state.get(slot_id, "available")
                        slot_last_state[slot_id] = state
                        status[slot_id] = state

                        update_slot_status(db, slot_id, state)

                        # ParkingSession tracking (requested feature)
                        if state == "occupied" and prev != "occupied":
                            sess = ParkingSession(slot_id=slot_id, entry_time=now)
                            db.add(sess)
                            db.commit()
                        elif state == "available" and prev == "occupied":
                            open_sess = (
                                db.query(ParkingSession)
                                .filter(ParkingSession.slot_id == slot_id, ParkingSession.exit_time.is_(None))
                                .order_by(ParkingSession.entry_time.desc())
                                .first()
                            )
                            if open_sess:
                                open_sess.exit_time = now
                                open_sess.duration_minutes = int((now - open_sess.entry_time).total_seconds() / 60)
                                db.commit()

                        # Existing billing logic (kept)
                        if state == "occupied" and prev != "occupied":
                            slot_entry_time[slot_id] = now
                            tx = Transaction(slot_id=slot_id, entry_time=now, status="open")
                            db.add(tx)
                            db.commit()
                        elif state == "available" and prev == "occupied":
                            started = slot_entry_time.pop(slot_id, None)
                            if started:
                                minutes = int((now - started).total_seconds() / 60)
                                rate_per_hour = 2.0
                                amount = round(rate_per_hour * (minutes / 60.0), 2)
                                tx = (
                                    db.query(Transaction)
                                    .filter(Transaction.slot_id == slot_id, Transaction.status == "open")
                                    .order_by(Transaction.entry_time.desc())
                                    .first()
                                )
                                if tx:
                                    tx.exit_time = now
                                    tx.duration_mins = minutes
                                    tx.amount = amount
                                    tx.status = "completed"
                                    db.commit()
                    db.close()
                except Exception as e:
                    print(f"Error updating occupancy/billing/sessions: {e}")

            # Publish latest raw frame for snapshot (slot editor)
            try:
                ok_raw, buf_raw = cv2.imencode(".jpg", frame)
                if ok_raw:
                    api_app.state.latest_raw_jpeg = buf_raw.tobytes()
            except Exception:
                pass

            annotated = _annotate_frame(frame, slot_bboxes, last_occupancy, last_detections)
            if out:
                try:
                    out.write(annotated)
                except Exception:
                    pass

            # Publish latest processed frame for MJPEG streaming endpoint
            try:
                ok, buffer = cv2.imencode(".jpg", annotated)
                if ok:
                    api_app.state.latest_jpeg = buffer.tobytes()
                    api_app.state.latest_jpeg_ts = datetime.utcnow().timestamp()
            except Exception as e:
                print(f"Error encoding latest frame: {e}")
            
            # Small delay to prevent overloading
            await asyncio.sleep(0.1)
        
        api_app.state.camera_open = False
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
        if out:
            out.release()
