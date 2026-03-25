from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import cv2
import os
import json
import math
import numpy as np
from datetime import datetime
from sqlalchemy import or_
from ultralytics import solutions
try:
    from .api import app as api_app
    from .database import (
        create_tables,
        initialize_slots,
        SessionLocal,
        update_slot_status,
        Transaction,
        ParkingSession,
        OccupancyHistory,
        ParkingHistory,
        PlateLog,
        Alert,
    )
    from .config import Config
    from .parking_logic import get_parking_statistics
    from .speed_estimator import estimate_speed, SPEED_ALERT_KMH
    from .wrong_way import check_wrong_way
    from .abandoned_vehicle import update_active_from_occupancy, check_abandoned_loop
    from .lpr import read_plate_with_confidence, LPR_AVAILABLE
except ImportError:
    from api import app as api_app
    from database import (
        create_tables,
        initialize_slots,
        SessionLocal,
        update_slot_status,
        Transaction,
        ParkingSession,
        OccupancyHistory,
        ParkingHistory,
        PlateLog,
        Alert,
    )
    from config import Config
    from parking_logic import get_parking_statistics
    from speed_estimator import estimate_speed, SPEED_ALERT_KMH
    from wrong_way import check_wrong_way
    from abandoned_vehicle import update_active_from_occupancy, check_abandoned_loop
    from lpr import read_plate_with_confidence, LPR_AVAILABLE

status = {}  # slot_id -> 'occupied' | 'available'
reload_flag = False
annotated_url = None
last_occupancy_history_ts = 0.0


def _get_speed_alert_threshold():
    """Read speed alert threshold from settings.json, fallback to hardcoded."""
    try:
        settings_path = os.path.join(os.path.dirname(__file__), "../backend/settings.json")
        if not os.path.exists(settings_path):
            settings_path = os.path.join(os.path.dirname(__file__), "settings.json")
        if os.path.exists(settings_path):
            with open(settings_path, 'r') as f:
                data = json.load(f)
            return float(data.get("speed_alert_kmh", SPEED_ALERT_KMH))
    except Exception:
        pass
    return SPEED_ALERT_KMH


def _get_total_slots_from_json():
    """Read total slot count from the saved SlotEditor JSON file."""
    try:
        src = getattr(Config, "VIDEO_SOURCE", None)
        if src == 0 or src == "0":
            slots_path = Config.PARKING_SLOTS_JSON_WEBCAM
        else:
            slots_path = Config.PARKING_SLOTS_JSON
        if os.path.exists(slots_path):
            with open(slots_path, 'r') as f:
                data = json.load(f)
            return len(data.get("parking_areas", []))
    except Exception:
        pass
    return 0

# In-memory tracking for simple billing based on slot occupancy changes
slot_last_state = {}   # slot_id -> last status
slot_entry_time = {}   # slot_id -> datetime of last occupied transition

# Simple centroid tracker for entry/exit transactions
track_next_id = 1
tracks = {}  # id -> {"centroid": (x,y), "last_seen": ts, "has_entered": bool, "entered_at": datetime|None, "tx_open": bool}

# Speed estimation & wrong-way state
prev_gray_frame = None  # previous grayscale frame for optical flow
track_centroid_history = {}  # track_id -> list of (cx, cy) tuples (max 20)
# Speed cache: track_id -> last estimated speed km/h
track_speed_cache = {}
# LPR cache: track_id -> plate string (avoid re-reading same track)
track_plate_cache = {}
# Wrong-way alert cooldown
wrong_way_alert_cooldown = {}  # zone_id -> last_alert_ts


def _load_runtime_settings():
    """Read current backend settings with safe defaults."""
    defaults = {
        "pricing_enabled": True,
        "pricing_unit": "hour",
        "zone_pricing": {"A": 2, "B": 1, "C": 4},
        "zone_duration": {"A": 1, "B": 1, "C": 1},
        "grace_period_minutes": 15,
        "max_daily_charge": 20,
    }
    try:
        settings_path = os.path.join(os.path.dirname(__file__), "../backend/settings.json")
        if not os.path.exists(settings_path):
            settings_path = os.path.join(os.path.dirname(__file__), "settings.json")
        if os.path.exists(settings_path):
            with open(settings_path, "r") as f:
                data = json.load(f)
            defaults.update(data or {})
    except Exception:
        pass
    return defaults


def _get_zone_from_slot_id(slot_id):
    if not slot_id:
        return "A"
    first = str(slot_id)[0].upper()
    return first if first in {"A", "B", "C"} else "A"


def _calculate_zone_amount(slot_id, duration_minutes):
    settings = _load_runtime_settings()
    if not settings.get("pricing_enabled", True):
        return 0.0

    zone = _get_zone_from_slot_id(slot_id)
    zone_pricing = settings.get("zone_pricing") or {}
    zone_duration = settings.get("zone_duration") or {}
    pricing_unit = settings.get("pricing_unit", "hour")

    price = float(zone_pricing.get(zone, zone_pricing.get("A", 2)) or 0)
    duration_value = float(zone_duration.get(zone, zone_duration.get("A", 1)) or 1)
    grace_period = max(0, int(settings.get("grace_period_minutes", 15) or 0))
    max_daily_charge = float(settings.get("max_daily_charge", 20) or 20)

    billable_minutes = max(0, int(duration_minutes) - grace_period)
    if billable_minutes <= 0 or price <= 0:
        return 0.0

    block_minutes = duration_value if pricing_unit == "minute" else duration_value * 60
    block_minutes = max(1, int(round(block_minutes)))
    billable_blocks = math.ceil(billable_minutes / block_minutes)
    return round(min(billable_blocks * price, max_daily_charge), 2)


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
        # Maintain centroid history for wrong-way detection
        if tid not in track_centroid_history:
            track_centroid_history[tid] = []
        track_centroid_history[tid].append((cx, cy))
        if len(track_centroid_history[tid]) > 20:
            track_centroid_history[tid] = track_centroid_history[tid][-20:]

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
        del tracks[tid]
        track_centroid_history.pop(tid, None)
        track_speed_cache.pop(tid, None)
        track_plate_cache.pop(tid, None)

    return assignments


def _extract_plate_crop(frame, detections, cx, cy):
    """
    Estimate a plate crop from the nearest vehicle detection.
    Uses the lower-center section of the vehicle box where plates usually appear.
    """
    if frame is None or not detections:
        return None

    best_bbox = None
    best_dist = float("inf")

    for det in detections:
        try:
            x1, y1, x2, y2 = det["bbox"]
        except Exception:
            continue

        contains = x1 <= cx <= x2 and y1 <= cy <= y2
        dcx = (x1 + x2) / 2.0
        dcy = (y1 + y2) / 2.0
        dist = float(np.hypot(cx - dcx, cy - dcy))

        if contains:
            best_bbox = (x1, y1, x2, y2)
            break
        if dist < best_dist:
            best_dist = dist
            best_bbox = (x1, y1, x2, y2)

    if best_bbox is None:
        return None

    x1, y1, x2, y2 = best_bbox
    h, w = frame.shape[:2]
    box_w = max(1.0, float(x2 - x1))
    box_h = max(1.0, float(y2 - y1))

    crop_x1 = int(max(0, x1 + box_w * 0.2))
    crop_x2 = int(min(w, x2 - box_w * 0.2))
    crop_y1 = int(max(0, y1 + box_h * 0.55))
    crop_y2 = int(min(h, y1 + box_h * 0.92))

    if crop_x2 <= crop_x1 or crop_y2 <= crop_y1:
        crop_x1 = int(max(0, x1))
        crop_x2 = int(min(w, x2))
        crop_y1 = int(max(0, y1))
        crop_y2 = int(min(h, y2))

    crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]
    return crop if crop.size > 0 else None

# Share latest processed frame with API for live feed
api_app.state.latest_jpeg = None
api_app.state.latest_jpeg_ts = 0.0
api_app.state.latest_raw_jpeg = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"Startup: configured database {Config.DATABASE_URL}", flush=True)
    create_tables()
    try:
        from . import database as database_module
    except ImportError:
        import database as database_module
    print(f"Startup: active database {database_module.ACTIVE_DATABASE_URL}", flush=True)
    print("Startup: database ready", flush=True)

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
        try:
            from .database import ParkingSlot
        except ImportError:
            from database import ParkingSlot
        db.query(ParkingSlot).delete()
        db.commit()
        print("Startup: slots reset", flush=True)
    except Exception as e:
        print(f"Error clearing slots: {e}", flush=True)
    finally:
        db.close()

    # Load YOLO model ONCE at startup (shared via app.state)
    try:
        from ultralytics import YOLO
        model_path = os.path.join(os.path.dirname(__file__), "yolov8n.pt")
        if not os.path.exists(model_path):
            model_path = Config.YOLO_MODEL_PATH
        app.state.model = YOLO(model_path)
        print("Startup: YOLO model loaded", flush=True)
    except Exception as e:
        print(f"Error loading YOLO model: {e}", flush=True)
        app.state.model = None
    
    # Start background video processing task
    video_task = asyncio.create_task(process_video_wrapper())
    # Start abandoned vehicle checker
    abandoned_task = asyncio.create_task(check_abandoned_loop())
    print("Startup: application ready", flush=True)
    
    yield
    # Shutdown
    if video_task:
        video_task.cancel()
        try:
            await video_task
        except asyncio.CancelledError:
            pass
    if abandoned_task:
        abandoned_task.cancel()
        try:
            await abandoned_task
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
            # Override total with saved slot count from SlotEditor
            total_from_json = _get_total_slots_from_json()
            if total_from_json > 0:
                occupied = stats.get("occupied", 0)
                stats["total"] = total_from_json
                stats["available"] = max(0, total_from_json - occupied)
                stats["occupancy_rate"] = round((occupied / total_from_json) * 100, 2) if total_from_json > 0 else 0
            # Zero out when camera not active
            camera_active = bool(getattr(api_app.state, "camera_open", False) and getattr(api_app.state, "camera_last_read_ok", False))
            if not camera_active:
                stats = {"total": 0, "available": 0, "occupied": 0, "occupancy_rate": 0}
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

async def process_video_wrapper():
    """Wrapper to prevent video processing errors from crashing the server."""
    try:
        await process_video()
    except Exception as e:
        print(f"Video processing error (non-fatal): {e}", flush=True)

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
    # Keep the processing loop cooperative so API requests are still served.
    frame_loop_sleep = 0.001
    max_infer_width = 960
    
    loop = asyncio.get_event_loop()

    def _slots_path_for_source(source):
        if source == 0 or source == "0":
            return Config.PARKING_SLOTS_JSON_WEBCAM
        return Config.PARKING_SLOTS_JSON

    # Cache slot JSON (reload on mtime changes)
    slots_cache = {
        "mtime": None,
        "path": None,
        "raw": {},
        "parking_areas": [],   # list of {points: [...], zone: "A"}
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
            # Normalize parking_areas to new format: list of {points, zone}
            raw_areas = raw.get("parking_areas", []) or []
            normalized = []
            for area in raw_areas:
                if isinstance(area, dict) and 'points' in area:
                    normalized.append({"points": area["points"], "zone": area.get("zone", "A")})
                elif isinstance(area, list):
                    normalized.append({"points": area, "zone": "A"})
            slots_cache["parking_areas"] = normalized
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
        slot_zones_local = {}
        for idx, area in enumerate(slots_cache.get("parking_areas") or []):
            points = area.get("points", []) if isinstance(area, dict) else area
            zone = area.get("zone", "A") if isinstance(area, dict) else "A"
            scaled_area = _scale_points(points, scale_x, scale_y)
            if not scaled_area:
                continue
            xs = [p[0] for p in scaled_area]
            ys = [p[1] for p in scaled_area]
            x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
            slot_id = f"S{idx+1}"
            slot_bboxes_local[slot_id] = [x1, y1, x2, y2]
            slot_polygons_local[slot_id] = scaled_area
            slot_zones_local[slot_id] = zone

        scaled_entry = _scale_points(slots_cache.get("entry_zone"), scale_x, scale_y) if slots_cache.get("entry_zone") else None
        scaled_exit = _scale_points(slots_cache.get("exit_zone"), scale_x, scale_y) if slots_cache.get("exit_zone") else None
        return slot_bboxes_local, slot_polygons_local, slot_zones_local, scaled_entry, scaled_exit

    def _draw_flow_zone(image, points, color, label):
        if not points or len(points) < 2:
            return
        pts = np.array([[int(p[0]), int(p[1])] for p in points], np.int32)
        cv2.polylines(image, [pts], isClosed=True, color=color, thickness=2)
        if len(points) >= 3:
            overlay = image.copy()
            cv2.fillPoly(overlay, [pts], color)
            cv2.addWeighted(overlay, 0.12, image, 0.88, 0, image)
        label_x = int(points[0][0])
        label_y = max(18, int(points[0][1]) - 10)
        cv2.putText(
            image,
            label,
            (label_x, label_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            color,
            2,
        )

    def _annotate_frame(frame, slot_bboxes_local, slot_zones_local, occupancy_map, detections_local, entry_points=None, exit_points=None):
        annotated = frame.copy()

        # Zone color map (BGR)
        zone_colors = {
            "A": (0, 165, 255),   # Amber/Gold
            "B": (219, 152, 52),  # Blue
            "C": (182, 89, 155),  # Purple
        }

        # Draw vehicle boxes first.
        for det in detections_local or []:
            try:
                x1, y1, x2, y2 = det["bbox"]
                cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), (255, 255, 0), 2)
            except Exception:
                continue

        # Draw slots with zone colors (dimmed when occupied)
        for slot_id, (x1, y1, x2, y2) in (slot_bboxes_local or {}).items():
            state = (occupancy_map or {}).get(slot_id, "available")
            zone = (slot_zones_local or {}).get(slot_id, "A")
            base_color = zone_colors.get(zone, (0, 255, 0))
            if state == "occupied":
                # Darker shade when occupied
                color = tuple(max(0, c - 100) for c in base_color)
            else:
                color = base_color
            cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            label = f"{slot_id} Z{zone} {state}"
            cv2.putText(
                annotated,
                label,
                (int(x1), max(0, int(y1) - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                color,
                2,
            )
        _draw_flow_zone(annotated, entry_points, (16, 185, 129), "ENTRY")
        _draw_flow_zone(annotated, exit_points, (94, 63, 244), "EXIT")
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
                    cap = await loop.run_in_executor(None, cv2.VideoCapture, current_source)
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
        
        # Writing annotated files on every processed frame adds noticeable overhead
        # and the generated URL is not consumed anywhere in the app.
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
        slot_zones = {}
        scaled_entry = None
        scaled_exit = None
        last_slots_mtime_built = None
        last_infer_ts = 0.0
        prev_gray = None  # for speed estimation optical flow

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
                slot_zones = {}
                scaled_entry = None
                scaled_exit = None
                prev_gray = None
            
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
                        await asyncio.sleep(frame_loop_sleep)
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
                    slot_bboxes, slot_polygons, slot_zones, scaled_entry, scaled_exit = _build_slot_bboxes(w, h, slots_path)
                    last_slots_mtime_built = slots_cache.get("mtime")
                    if slot_bboxes:
                        try:
                            db_init = SessionLocal()
                            initialize_slots(db_init, slot_bboxes)
                        finally:
                            db_init.close()
            except Exception:
                pass

            # Run inference on every Nth frame for performance
            now_ts = datetime.utcnow().timestamp()
            run_infer = (frame_count % Config.FRAME_SKIP == 0)
            detections = last_detections
            det_centroids = []
            if run_infer and model is not None:
                try:
                    last_infer_ts = now_ts
                    # YOLO expects RGB for best results
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    infer_scale = 1.0
                    if frame_rgb.shape[1] > max_infer_width:
                        infer_scale = max_infer_width / float(frame_rgb.shape[1])
                        frame_rgb = cv2.resize(
                            frame_rgb,
                            (int(frame_rgb.shape[1] * infer_scale), int(frame_rgb.shape[0] * infer_scale)),
                            interpolation=cv2.INTER_AREA,
                        )
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
                                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                                if infer_scale != 1.0:
                                    x1 /= infer_scale
                                    y1 /= infer_scale
                                    x2 /= infer_scale
                                    y2 /= infer_scale
                                detections.append({"bbox": [float(x1), float(y1), float(x2), float(y2)]})
                                det_centroids.append((float((x1 + x2) / 2.0), float((y1 + y2) / 2.0)))
                            except Exception:
                                continue
                    last_detections = detections
                except Exception as e:
                    print(f"YOLO inference error: {e}")

            # Speed estimation via optical flow
            curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            speed_estimates = {}  # detection_idx -> speed_kmh
            if prev_gray is not None and detections:
                for di, det in enumerate(detections):
                    spd = estimate_speed(prev_gray, curr_gray, det["bbox"], fps=30.0)
                    if spd is not None:
                        speed_estimates[di] = spd
                        det["speed_kmh"] = spd
            prev_gray = curr_gray

            # Entry/Exit based transactions (preferred when zones exist)
            if scaled_entry and scaled_exit and det_centroids:
                try:
                    now = datetime.utcnow()
                    now_ts = now.timestamp()
                    assigned = assign_tracks(det_centroids, now_ts)

                    db = SessionLocal()
                    for tid, (cx, cy) in assigned:
                        tinfo = tracks.get(tid)
                        if not tinfo:
                            continue

                        in_entry = point_in_polygon((cx, cy), scaled_entry)
                        in_exit = point_in_polygon((cx, cy), scaled_exit)

                        # Wrong-way detection
                        history = track_centroid_history.get(tid, [])
                        if len(history) >= 6:
                            wrong_zone = check_wrong_way(tid, history)
                            if wrong_zone:
                                now_cooldown = now.timestamp()
                                last_alert = wrong_way_alert_cooldown.get(wrong_zone, 0)
                                if (now_cooldown - last_alert) > 30.0:  # 30s cooldown per zone
                                    wrong_way_alert_cooldown[wrong_zone] = now_cooldown
                                    try:
                                        alert = Alert(
                                            alert_type="wrong_way",
                                            vehicle_id=f"veh-{tid}",
                                            detail=json.dumps({"zone": wrong_zone}),
                                        )
                                        db.add(alert)
                                        db.commit()
                                        print(f"Wrong-way alert: track {tid} in {wrong_zone}")
                                    except Exception:
                                        db.rollback()

                        # Mark entered once we see the track in entry zone
                        if in_entry and not tinfo["has_entered"]:
                            tinfo["has_entered"] = True
                            tinfo["entered_at"] = now

                            # Attempt LPR on vehicle crop
                            plate = track_plate_cache.get(tid)
                            plate_confidence = None
                            try:
                                if LPR_AVAILABLE and not plate:
                                    crop = _extract_plate_crop(frame, detections, cx, cy)
                                    if crop is not None:
                                        plate, plate_confidence = read_plate_with_confidence(crop)
                                        if plate:
                                            track_plate_cache[tid] = plate
                                if plate:
                                    log = PlateLog(
                                        plate=plate,
                                        event_type="entry",
                                        confidence=plate_confidence if plate_confidence is not None else 0.0,
                                    )
                                    db.add(log)
                                    db.commit()
                            except Exception as e:
                                print(f"LPR error on entry: {e}")

                            plate_str = plate or f"veh-{tid}"
                            tx = Transaction(
                                plate=plate_str,
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
                            amount = _calculate_zone_amount(None, minutes)

                            # Log exit LPR
                            plate = track_plate_cache.get(tid)
                            plate_confidence = None
                            try:
                                if LPR_AVAILABLE and not plate:
                                    crop = _extract_plate_crop(frame, detections, cx, cy)
                                    if crop is not None:
                                        plate, plate_confidence = read_plate_with_confidence(crop)
                                        if plate:
                                            track_plate_cache[tid] = plate
                                if plate:
                                    log = PlateLog(
                                        plate=plate,
                                        event_type="exit",
                                        confidence=plate_confidence if plate_confidence is not None else 0.0,
                                    )
                                    db.add(log)
                                    db.commit()
                            except Exception:
                                pass

                            plate_filters = [Transaction.plate == f"veh-{tid}"]
                            if plate:
                                plate_filters.append(Transaction.plate == plate)

                            tx = (
                                db.query(Transaction)
                                .filter(
                                    Transaction.status == "open",
                                    or_(*plate_filters),
                                )
                                .order_by(Transaction.entry_time.desc())
                                .first()
                            )
                            if tx:
                                if plate:
                                    tx.plate = plate
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
                    now_ts = now.timestamp()
                    db = SessionLocal()
                    # Store occupancy rate history for charts
                    global last_occupancy_history_ts
                    if (now_ts - last_occupancy_history_ts) >= 2.0:
                        try:
                            stats_now = get_parking_statistics(occupancy)
                            db.add(OccupancyHistory(timestamp=now, occupancy_rate=float(stats_now.get("occupancy_rate", 0.0))))
                            db.commit()
                            last_occupancy_history_ts = now_ts
                        except Exception:
                            db.rollback()
                    for slot_id, state in occupancy.items():
                        prev = slot_last_state.get(slot_id, "available")
                        slot_last_state[slot_id] = state
                        status[slot_id] = state

                        if state == prev:
                            continue

                        closed_duration_minutes = None
                        if state == "available" and prev == "occupied":
                            open_sess = (
                                db.query(ParkingSession)
                                .filter(ParkingSession.slot_id == slot_id, ParkingSession.exit_time.is_(None))
                                .order_by(ParkingSession.entry_time.desc())
                                .first()
                            )
                            if open_sess:
                                open_sess.exit_time = now
                                closed_duration_minutes = int((now - open_sess.entry_time).total_seconds() / 60)
                                open_sess.duration_minutes = closed_duration_minutes
                                db.commit()

                        update_slot_status(db, slot_id, state, dwell_minutes=closed_duration_minutes)

                        # ParkingSession tracking (requested feature)
                        if state == "occupied" and prev != "occupied":
                            sess = ParkingSession(slot_id=slot_id, entry_time=now)
                            db.add(sess)
                            db.commit()

                            # Log speed if available (from nearest detection)
                            det_speed = None
                            for di, det in enumerate(detections):
                                bx1, by1, bx2, by2 = det["bbox"]
                                dcx, dcy = (bx1 + bx2) / 2, (by1 + by2) / 2
                                sx1, sy1, sx2, sy2 = slot_bboxes[slot_id]
                                if sx1 < dcx < sx2 and sy1 < dcy < sy2:
                                    det_speed = det.get("speed_kmh")
                                    break
                            if det_speed is not None:
                                try:
                                    hist = ParkingHistory(
                                        slot_id=slot_id,
                                        status="occupied",
                                        speed_kmh=det_speed,
                                    )
                                    db.add(hist)
                                    db.commit()
                                except Exception:
                                    db.rollback()

                            # Speed alert
                            speed_limit = _get_speed_alert_threshold()
                            if det_speed and det_speed > speed_limit:
                                try:
                                    alert = Alert(
                                        alert_type="speed",
                                        slot_id=slot_id,
                                        detail=json.dumps({"speed_kmh": det_speed}),
                                    )
                                    db.add(alert)
                                    db.commit()
                                except Exception:
                                    db.rollback()
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
                                amount = _calculate_zone_amount(slot_id, minutes)
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

                    # Sync abandoned vehicle tracker
                    try:
                        update_active_from_occupancy(occupancy, tracks)
                    except Exception:
                        pass
                except Exception as e:
                    print(f"Error updating occupancy/billing/sessions: {e}")

            # Publish latest raw frame for snapshot (slot editor)
            try:
                ok_raw, buf_raw = cv2.imencode(".jpg", frame)
                if ok_raw:
                    api_app.state.latest_raw_jpeg = buf_raw.tobytes()
            except Exception:
                pass

            annotated = _annotate_frame(frame, slot_bboxes, slot_zones, last_occupancy, last_detections, scaled_entry, scaled_exit)
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

            await asyncio.sleep(frame_loop_sleep)
        
        api_app.state.camera_open = False
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
        if out:
            out.release()
