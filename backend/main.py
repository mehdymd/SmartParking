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
from api import app as api_app
from database import create_tables, initialize_slots, SessionLocal, update_slot_status, Transaction
from config import Config
from parking_logic import get_parking_statistics, determine_occupancy

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_tables()
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
    try:
        while True:
            stats = get_parking_statistics(status)
            data = {
                "status": status,
                "stats": stats,
                "timestamp": "current"
            }
            if stats['occupancy_rate'] > Config.ALERT_THRESHOLD:
                data['alert'] = {"message": "Parking lot is almost full!"}
            await websocket.send_json(data)
            await asyncio.sleep(1)
    except Exception:
        pass

# Include API routes
app.include_router(api_app.router)

async def process_video():
    """
    Background task to process video stream and update parking status using Ultralytics ParkingManagement.
    """
    while True:
        if not Config.VIDEO_SOURCE:
            await asyncio.sleep(1)
            continue
        
        current_source = Config.VIDEO_SOURCE
        cap = cv2.VideoCapture(current_source)
        if not cap.isOpened():
            print(f"Error: Cannot open video source {current_source}")
            await asyncio.sleep(5)
            continue
        
        if current_source != 0:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
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
        while True:
            # Check if source changed
            if Config.VIDEO_SOURCE != current_source:
                cap.release()
                current_source = Config.VIDEO_SOURCE
                cap = cv2.VideoCapture(current_source)
                if not cap.isOpened():
                    print(f"Error: Cannot open video source {current_source}")
                    break
                frame_count = 0  # Reset frame count
            
            ret, frame = cap.read()
            if not ret:
                if Config.VIDEO_SOURCE and not Config.VIDEO_SOURCE.startswith('http') and not Config.VIDEO_SOURCE.startswith('/dev/'):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                else:
                    break
            
            frame_count += 1
            if frame_count % Config.FRAME_SKIP != 0:
                continue
            
            # Process frame with YOLO and draw slots/detections
            from ultralytics import YOLO
            model = YOLO(Config.YOLO_MODEL_PATH)
            
            # Load parking slots and optional entry/exit zones
            try:
                with open(Config.PARKING_SLOTS_JSON, 'r') as f:
                    slots_data = json.load(f)
                parking_areas = slots_data.get('parking_areas', [])
                entry_zone = slots_data.get('entry_zone')
                exit_zone = slots_data.get('exit_zone')
            except Exception as e:
                print(f"Error loading parking slots: {e}")
                parking_areas = []
                entry_zone = None
                exit_zone = None
                slots_data = {}
            
            # Scale polygons to current frame size if dimensions provided
            if 'frame_width' in slots_data and 'frame_height' in slots_data:
                scale_x = width / slots_data['frame_width']
                scale_y = height / slots_data['frame_height']
                scaled_parking_areas = []
                for area in parking_areas:
                    scaled_area = []
                    for p in area:
                        # support both dict {"x","y"} and [x,y]
                        if isinstance(p, dict):
                            x, y = p.get('x', 0), p.get('y', 0)
                        else:
                            x, y = p[0], p[1]
                        scaled_area.append([x * scale_x, y * scale_y])
                    scaled_parking_areas.append(scaled_area)
                parking_areas = scaled_parking_areas
            
            # Run YOLO
            results = model.predict(frame, conf=Config.CONF, iou=Config.IOU, device=Config.DEVICE, verbose=False)
            
            # Draw parking slots and build slot bounding boxes
            slot_bboxes = {}  # slot_id -> [x1,y1,x2,y2]
            for idx, area in enumerate(parking_areas):
                if not area:
                    continue
                points = np.array(area, np.int32)
                cv2.polylines(frame, [points], True, (255, 0, 0), 2)
                xs = [p[0] for p in area]
                ys = [p[1] for p in area]
                x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
                slot_id = f"S{idx+1}"
                slot_bboxes[slot_id] = [x1, y1, x2, y2]
                # Slot label
                try:
                    label_x, label_y = int(xs[0]), int(ys[0])
                    cv2.putText(frame, slot_id, (label_x, max(0, label_y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
                except Exception:
                    pass

            # Draw entry/exit zones if present (scaled using same factors)
            def _scale_zone(zone):
                if not zone:
                    return None
                scaled = []
                for p in zone:
                    if isinstance(p, dict):
                        x, y = p.get('x', 0), p.get('y', 0)
                    else:
                        x, y = p[0], p[1]
                    if 'frame_width' in slots_data and 'frame_height' in slots_data:
                        x *= scale_x
                        y *= scale_y
                    scaled.append([x, y])
                return scaled

            scaled_entry = _scale_zone(entry_zone)
            scaled_exit = _scale_zone(exit_zone)
            if scaled_entry and len(scaled_entry) >= 2:
                cv2.polylines(frame, [np.array(scaled_entry, np.int32)], True, (0, 255, 0), 2)
            if scaled_exit and len(scaled_exit) >= 2:
                cv2.polylines(frame, [np.array(scaled_exit, np.int32)], True, (255, 255, 0), 2)
            
            # Collect detection bboxes for occupancy logic
            detections = []
            det_centroids = []
            if results:
                for result in results:
                    for box in result.boxes:
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                        detections.append({"bbox": [float(x1), float(y1), float(x2), float(y2)]})
                        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                        det_centroids.append((float((x1 + x2) / 2.0), float((y1 + y2) / 2.0)))

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
            
            # Update occupancy, DB, and global status
            if slot_bboxes:
                try:
                    occupancy = determine_occupancy(detections, slot_bboxes, iou_threshold=Config.IOU_THRESHOLD)
                    now = datetime.utcnow()
                    db = SessionLocal()
                    for slot_id, state in occupancy.items():
                        prev = slot_last_state.get(slot_id, "available")
                        slot_last_state[slot_id] = state
                        status[slot_id] = state
                        # Persist slot status + history
                        update_slot_status(db, slot_id, state)
                        
                        # Simple billing: start transaction on occupied, close on available
                        if state == "occupied" and prev != "occupied":
                            slot_entry_time[slot_id] = now
                            tx = Transaction(
                                slot_id=slot_id,
                                entry_time=now,
                                status="open"
                            )
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
                    print(f"Error updating occupancy/billing: {e}")
            if out:
                if results:
                    for result in results:
                        if 'bbox' in result:
                            x1, y1, x2, y2 = result['bbox']
                            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                out.write(frame)

            # Publish latest processed frame for MJPEG streaming endpoint
            try:
                ok, buffer = cv2.imencode(".jpg", frame)
                if ok:
                    api_app.state.latest_jpeg = buffer.tobytes()
                    api_app.state.latest_jpeg_ts = datetime.utcnow().timestamp()
            except Exception as e:
                print(f"Error encoding latest frame: {e}")
            
            # Small delay to prevent overloading
            await asyncio.sleep(0.1)
        
        cap.release()
        if out:
            out.release()
