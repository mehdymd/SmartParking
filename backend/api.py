from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timedelta
import json
import os
import shutil
import uuid
import base64
import io
from PIL import Image
import numpy as np
import cv2
import sys
sys.path.append('../ultralytics_lib')

try:
    from .database import (
        get_db,
        get_all_slots,
        ParkingHistory,
        PlateLog,
        Transaction,
        ExportHistory,
        OccupancyHistory,
        ParkingSession,
        Alert,
        update_slot_status,
    )
    from .parking_logic import get_parking_statistics
    from .config import Config
    from .heatmap import get_heatmap
except ImportError:
    from database import (
        get_db,
        get_all_slots,
        ParkingHistory,
        PlateLog,
        Transaction,
        ExportHistory,
        OccupancyHistory,
        ParkingSession,
        Alert,
        update_slot_status,
    )
    from parking_logic import get_parking_statistics
    from config import Config
    # NOTE: YOLO model is loaded once in backend/main.py lifespan.
    from heatmap import get_heatmap

# Load settings (always relative to backend directory)
_BACKEND_DIR = os.path.dirname(__file__)
_SETTINGS_PATH = os.path.join(_BACKEND_DIR, "settings.json")
try:
    with open(_SETTINGS_PATH, "r") as f:
        settings = json.load(f)
except Exception:
    settings = {}

VIDEO_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "..", "videos"))
os.makedirs(VIDEO_DIR, exist_ok=True)

yolo_model = None  # legacy; prefer app.state.model

app = FastAPI(title="Smart Parking Management System")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_image_file(path_or_name: str) -> bool:
    return str(path_or_name).lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))


def _is_video_file(path_or_name: str) -> bool:
    return str(path_or_name).lower().endswith(('.mp4', '.avi', '.mov', '.mkv'))


def _source_mode(source):
    if source is None or source == "":
        return "none"
    if source == 0 or source == "0":
        return "camera"
    return "upload"


def _validate_source_file(path: str):
    if _is_image_file(path):
        image = cv2.imread(path)
        return image is not None

    cap = cv2.VideoCapture(path)
    try:
        if not cap.isOpened():
            return False
        ok, _ = cap.read()
        return bool(ok)
    finally:
        cap.release()


def _format_duration_minutes(duration_mins, entry_time=None, exit_time=None):
    if duration_mins is None and entry_time is not None:
        end_time = exit_time or datetime.utcnow()
        try:
            duration_mins = max(0, int((end_time - entry_time).total_seconds() / 60))
        except Exception:
            duration_mins = None

    if duration_mins is None:
        return None

    total_minutes = max(0, int(duration_mins))
    hours, mins = divmod(total_minutes, 60)
    if hours and mins:
        return f"{hours}h {mins}m"
    if hours:
        return f"{hours}h"
    return f"{mins}m"


def _derive_duration_minutes(duration_mins, entry_time=None, exit_time=None):
    if duration_mins is not None:
        return max(0, int(duration_mins))
    if entry_time is None:
        return None
    try:
        end_time = exit_time or datetime.utcnow()
        return max(0, int((end_time - entry_time).total_seconds() / 60))
    except Exception:
        return None

@app.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file for processing."""
    if not file.filename.endswith(('.mp4', '.avi', '.mov', '.mkv')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only video files are allowed.")
    
    try:
        os.makedirs("videos", exist_ok=True)
        filename = f"{uuid.uuid4()}.mp4"
        with open(f"videos/{filename}", "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"message": f"Video {filename} uploaded successfully", "url": f"/videos/{filename}"}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/parking/upload-feed")
async def upload_feed(file: UploadFile = File(...)):
    """Upload a video or image file and update video source at runtime."""
    if not file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.jpg', '.jpeg', '.png', '.bmp', '.webp')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only video and image files are allowed.")
    
    try:
        ext = os.path.splitext(file.filename)[1].lower() or ".mp4"
        upload_path = os.path.join(VIDEO_DIR, f"uploaded_feed_{uuid.uuid4().hex}{ext}")
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        if not _validate_source_file(upload_path):
            try:
                os.unlink(upload_path)
            except FileNotFoundError:
                pass
            raise HTTPException(status_code=400, detail="Uploaded file could not be opened as a feed")

        previous_upload = getattr(app.state, "uploaded_feed_path", None)
        if previous_upload and previous_upload != upload_path and os.path.exists(previous_upload):
            try:
                os.unlink(previous_upload)
            except OSError:
                pass

        app.state.uploaded_feed_path = upload_path
        # Point processing pipeline to this uploaded file (hot-swap, no restart).
        Config.VIDEO_SOURCE = upload_path
        return {
            "message": "Feed uploaded and source updated",
            "source": upload_path,
            "mode": "upload",
            "filename": os.path.basename(upload_path),
        }
    except Exception as e:
        try:
            if "upload_path" in locals() and upload_path and os.path.exists(upload_path):
                os.unlink(upload_path)
        except Exception:
            pass
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/parking/play-uploaded")
async def play_uploaded():
    if os.path.exists("uploaded_video.mp4"):
        Config.VIDEO_SOURCE = "uploaded_video.mp4"
        return {"message": "Playing uploaded video"}
    else:
        return {"error": "No uploaded video found"}

@app.post("/parking/start-camera")
async def start_camera():
    import cv2
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        cap.release()
        raise HTTPException(status_code=500, detail="Camera not available")
    cap.release()
    Config.VIDEO_SOURCE = 0
    return {"message": "Camera started"}

@app.post("/parking/stop-camera")
async def stop_camera():
    Config.VIDEO_SOURCE = None
    return {"message": "Camera stopped"}

@app.get("/parking/video-feed")
async def video_feed():
    """Stream video frames from the current video source as an MJPEG stream."""
    # Prefer the processed frames produced by the background pipeline (YOLO + slots + DB updates)
    if getattr(app.state, "latest_jpeg", None):
        return StreamingResponse(generate_latest_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")


def generate_latest_frames():
    import time
    while True:
        frame_bytes = getattr(app.state, "latest_jpeg", None)
        if frame_bytes:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.001)


@app.get("/parking/snapshot")
async def parking_snapshot(annotated: bool = False):
    """
    Capture a single frame from the current video source and return it as a JPEG image.
    This is used by the slot editor to ensure polygons align with the active feed.
    """
    # Webcam source is 0, which is falsy; treat only None/"" as inactive.
    if Config.VIDEO_SOURCE is None or Config.VIDEO_SOURCE == "":
        raise HTTPException(status_code=404, detail="No active video source")

    # Optionally return the latest annotated frame for dashboard pause/review mode.
    if annotated:
        annotated_bytes = getattr(app.state, "latest_jpeg", None)
        if annotated_bytes:
            return Response(content=annotated_bytes, media_type="image/jpeg")

    # Prefer using the latest raw frame from the background pipeline to avoid
    # camera contention (opening a second VideoCapture often fails on webcam).
    raw_bytes = getattr(app.state, "latest_raw_jpeg", None)
    if raw_bytes:
        return Response(content=raw_bytes, media_type="image/jpeg")

    cap = cv2.VideoCapture(Config.VIDEO_SOURCE)
    if not cap.isOpened():
        cap.release()
        raise HTTPException(status_code=500, detail="Cannot open video source")

    ret, frame = cap.read()
    cap.release()
    if not ret:
        raise HTTPException(status_code=500, detail="Failed to capture frame")

    ok, buffer = cv2.imencode(".jpg", frame)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode frame")

    return Response(content=buffer.tobytes(), media_type="image/jpeg")

def generate_frames():
    """Generator function to yield video frames as JPEG images."""
    import time

    def scale_points(points, scale_x: float, scale_y: float):
        scaled = []
        for p in points or []:
            if isinstance(p, dict):
                x, y = p.get("x", 0), p.get("y", 0)
            else:
                x, y = p[0], p[1]
            scaled.append((int(x * scale_x), int(y * scale_y)))
        return scaled

    def draw_flow_zone(image, points, color, label):
        if not points or len(points) < 2:
            return
        pts = np.array(points, np.int32)
        cv2.polylines(image, [pts], isClosed=True, color=color, thickness=2)
        if len(points) >= 3:
            overlay = image.copy()
            cv2.fillPoly(overlay, [pts], color)
            cv2.addWeighted(overlay, 0.12, image, 0.88, 0, image)
        label_x = int(points[0][0])
        label_y = max(18, int(points[0][1]) - 10)
        cv2.putText(image, label, (label_x, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    if Config.VIDEO_SOURCE is None or Config.VIDEO_SOURCE == "":
        # Return placeholder frame continuously
        while True:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, "No video source", (200, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            ret, buffer = cv2.imencode('.jpg', frame)
            if ret:
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(1)
        return

    cap = cv2.VideoCapture(Config.VIDEO_SOURCE)
    if not cap.isOpened():
        # Fallback to placeholder frames if source cannot be opened
        while True:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, "Source error", (200, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            ret, buffer = cv2.imencode('.jpg', frame)
            if ret:
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(1)
        return

    # Load parking slots once and scale to video resolution
    parking_polygons = []
    try:
        # Use the same slots file selection logic as the main processing loop.
        slots_path = _get_slots_path_for_current_source()
        with open(slots_path, 'r') as f:
            slots_data = json.load(f)
        raw_areas = slots_data.get('parking_areas', [])
        raw_entry_zone = slots_data.get('entry_zone')
        raw_exit_zone = slots_data.get('exit_zone')
    except Exception:
        raw_areas = []
        raw_entry_zone = None
        raw_exit_zone = None

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1

    frame_width = slots_data.get('frame_width') if 'slots_data' in locals() else None
    frame_height = slots_data.get('frame_height') if 'slots_data' in locals() else None

    if frame_width and frame_height:
        scale_x = width / frame_width
        scale_y = height / frame_height
    else:
        scale_x = scale_y = 1.0

    for area in raw_areas:
        # Support both new {points, zone} and legacy flat array formats
        if isinstance(area, dict) and 'points' in area:
            raw_points = area['points']
            zone = area.get('zone', 'A')
        else:
            raw_points = area
            zone = 'A'
        points = []
        for p in raw_points:
            # Support both dict {"x","y"} and [x, y] formats
            if isinstance(p, dict):
                x, y = p.get('x', 0), p.get('y', 0)
            else:
                x, y = p[0], p[1]
            points.append((int(x * scale_x), int(y * scale_y)))
        if len(points) >= 2:
            parking_polygons.append({"points": np.array(points, np.int32), "zone": zone})

    entry_zone_points = scale_points(raw_entry_zone, scale_x, scale_y) if raw_entry_zone else None
    exit_zone_points = scale_points(raw_exit_zone, scale_x, scale_y) if raw_exit_zone else None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                # Loop playback for file-based sources
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue

            # Draw parking slot polygons with zone colors
            zone_colors = {
                "A": (0, 165, 255),   # Amber/Gold (BGR)
                "B": (219, 152, 52),  # Blue (BGR)
                "C": (182, 89, 155),  # Purple (BGR)
            }
            for slot in parking_polygons:
                poly = slot["points"]
                zone = slot["zone"]
                color = zone_colors.get(zone, (0, 255, 0))
                cv2.polylines(frame, [poly], isClosed=True, color=color, thickness=2)

            draw_flow_zone(frame, entry_zone_points, (16, 185, 129), "ENTRY")
            draw_flow_zone(frame, exit_zone_points, (94, 63, 244), "EXIT")

            ret, buffer = cv2.imencode('.jpg', frame)
            if not ret:
                continue
            frame_bytes = buffer.tobytes()

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
    finally:
        cap.release()


@app.post("/parking/override")
def parking_override(data: dict, db: Session = Depends(get_db)):
    """
    Manually override the status of a parking slot.
    Expects: { "slot_id": "...", "status": "available" | "occupied", ... }
    """
    slot_id = data.get("slot_id")
    status = data.get("status")

    if not slot_id or status not in {"available", "occupied"}:
        raise HTTPException(status_code=400, detail="Invalid slot_id or status")

    slot = update_slot_status(db, slot_id, status)
    return {"message": "Override applied", "slot": {"id": slot.id, "status": slot.status}}

@app.get("/parking/camera-status")
async def camera_status():
    """Check if the current video source is active and reading frames."""
    try:
        source = getattr(Config, "VIDEO_SOURCE", None)
        # Prefer background pipeline state (true "currently open and reading frames").
        if hasattr(app.state, "camera_open"):
            source = getattr(app.state, "camera_source", source)
            return {
                "active": bool(getattr(app.state, "camera_open", False) and getattr(app.state, "camera_last_read_ok", False)),
                "open": bool(getattr(app.state, "camera_open", False)),
                "source": source,
                "mode": _source_mode(source),
            }

        if source is None or source == "":
            return {"active": False, "open": False, "source": None, "mode": "none"}

        # Fallback: best-effort probe.
        cap = cv2.VideoCapture(source)
        is_open = cap.isOpened()
        ok = False
        if is_open:
            ok, _ = cap.read()
        cap.release()
        return {"active": bool(is_open and ok), "open": bool(is_open), "source": source, "mode": _source_mode(source)}
    except Exception as e:
        print(f"Camera status error: {e}")
        source = getattr(Config, "VIDEO_SOURCE", None)
        return {"active": False, "open": False, "source": source, "mode": _source_mode(source)}

@app.post("/parking/set-source")
async def set_source(data: dict):
    """Set the video source at runtime (e.g., to webcam or file path)."""
    source = data.get('source')
    if source is None or source == "":
        Config.VIDEO_SOURCE = None
        return {"message": "Source cleared", "mode": "none", "source": None}

    # Normalize webcam source
    if source == "0":
        source = 0

    try:
        if source == 0:
            cap = cv2.VideoCapture(source)
            valid = cap.isOpened()
            cap.release()
        else:
            valid = isinstance(source, str) and os.path.exists(source) and _validate_source_file(source)

        if not valid:
            raise HTTPException(status_code=400, detail="Source is invalid or not accessible")

        Config.VIDEO_SOURCE = source
        return {"message": "Source updated successfully", "mode": _source_mode(source), "source": source}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"Set source error: {e}")
        raise HTTPException(status_code=500, detail="Source validation failed")


@app.get("/parking/sessions")
async def get_sessions(limit: int = 50, db: Session = Depends(get_db)):
    """
    Get recent parking sessions (slot occupancy durations).
    """
    try:
        sessions = (
            db.query(ParkingSession)
            .order_by(ParkingSession.entry_time.desc())
            .limit(limit)
            .all()
        )
        return {
            "sessions": [
                {
                    "slot_id": s.slot_id,
                    "entry_time": (s.entry_time.isoformat() + "Z") if s.entry_time else None,
                    "exit_time": (s.exit_time.isoformat() + "Z") if s.exit_time else None,
                    "duration_minutes": s.duration_minutes,
                }
                for s in sessions
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load sessions: {e}")

from pydantic import BaseModel

class DetectRequest(BaseModel):
    image: str

@app.post("/detect-frame")
async def detect_frame(request: DetectRequest):
    """Detect vehicles in a base64 encoded image and return image with bounding boxes."""
    image_data = base64.b64decode(request.image)
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    model = getattr(app.state, "model", None)
    if model is None:
        raise HTTPException(status_code=500, detail="YOLO model is not loaded")

    results = model(np.array(image), conf=0.3, verbose=False)
    detections = []
    if results and len(results) > 0:
        for box in results[0].boxes:
            try:
                if int(box.cls[0]) not in [2, 5, 7]:
                    continue
                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                detections.append({"bbox": [x1, y1, x2, y2], "class": int(box.cls[0])})
            except Exception:
                continue
    
    # Draw bounding boxes
    img_array = np.array(image)
    for det in detections:
        bbox = det['bbox']
        x1, y1, x2, y2 = map(int, bbox)
        cv2.rectangle(img_array, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(img_array, str(det.get('class', 'car')), (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    
    _, encoded_img = cv2.imencode('.jpg', cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR))
    img_base64 = base64.b64encode(encoded_img.tobytes()).decode('utf-8')
    return {"image": img_base64}

def _get_slots_path_for_current_source():
    """
    Decide which slots JSON to use based on the active video source.
    Webcam (0) gets its own layout; everything else uses the default file.
    """
    src = getattr(Config, "VIDEO_SOURCE", None)
    if src == 0 or src == "0":
        return Config.PARKING_SLOTS_JSON_WEBCAM
    return Config.PARKING_SLOTS_JSON


@app.post("/update-parking-slots")
async def update_parking_slots(data: dict):
    """
    Update the parking slots configuration.
    Accepts both new format (list of {points, zone}) and legacy format (list of points).
    """
    parking_slots = data.get('parking_slots', [])
    entry_zone = data.get('entry_zone')
    exit_zone = data.get('exit_zone')

    # Normalize: convert to new format {points: [...], zone: "A"}
    normalized_slots = []
    for slot in parking_slots:
        if isinstance(slot, dict) and 'points' in slot:
            normalized_slots.append({
                "points": slot["points"],
                "zone": slot.get("zone", "A")
            })
        elif isinstance(slot, list):
            # Legacy flat array format
            normalized_slots.append({"points": slot, "zone": "A"})

    json_data = {"parking_areas": normalized_slots}
    if 'frame_width' in data:
        json_data['frame_width'] = data['frame_width']
        json_data['frame_height'] = data['frame_height']

    # Optional global entry/exit zones for revenue/flow analytics
    if entry_zone is not None:
        json_data['entry_zone'] = entry_zone
    if exit_zone is not None:
        json_data['exit_zone'] = exit_zone
    
    slots_path = _get_slots_path_for_current_source()
    os.makedirs(os.path.dirname(slots_path), exist_ok=True)
    with open(slots_path, 'w') as f:
        json.dump(json_data, f)
    
    return {"message": "Parking slots updated successfully. Changes applied directly."}


@app.post("/parking/slots")
async def save_slots(data: dict):
    """
    Alias endpoint for saving parking slots configuration.
    Frontend Slot Editor can POST here.
    """
    return await update_parking_slots(data)

@app.get("/parking/status")
def get_parking_status(db: Session = Depends(get_db)):
    """
    Get current status of all parking slots.
    """
    slots = get_all_slots(db)
    status = {slot.id: slot.status for slot in slots}
    return {"status": status}

@app.get("/parking/slots")
def get_parking_slots():
    """Get the current parking slot polygons with zone types and optional entry/exit zones."""
    try:
        slots_path = _get_slots_path_for_current_source()
        if not os.path.exists(slots_path):
            return {"polygons": [], "entry_zone": None, "exit_zone": None, "frame_width": None, "frame_height": None}
        with open(slots_path, 'r') as f:
            data = json.load(f)
        raw_areas = data.get("parking_areas", [])
        # Normalize: convert legacy flat arrays to {points, zone} format
        polygons = []
        for area in raw_areas:
            if isinstance(area, dict) and 'points' in area:
                polygons.append({"points": area["points"], "zone": area.get("zone", "A")})
            elif isinstance(area, list):
                polygons.append({"points": area, "zone": "A"})
        return {
            "polygons": polygons,
            "entry_zone": data.get("entry_zone"),
            "exit_zone": data.get("exit_zone"),
            "frame_width": data.get("frame_width"),
            "frame_height": data.get("frame_height"),
        }
    except:
        return {"polygons": [], "entry_zone": None, "exit_zone": None, "frame_width": None, "frame_height": None}

@app.get("/parking/stats")
def get_parking_stats(db: Session = Depends(get_db)):
    """
    Get parking statistics.
    Total reflects slots defined in SlotEditor (parking_slots.json).
    Returns all zeros when camera/video is not active.
    """
    # Check if camera is active
    camera_active = bool(getattr(app.state, "camera_open", False) and getattr(app.state, "camera_last_read_ok", False))

    # Get total from saved slots JSON (SlotEditor)
    total_from_json = 0
    try:
        slots_path = _get_slots_path_for_current_source()
        if os.path.exists(slots_path):
            with open(slots_path, 'r') as f:
                data = json.load(f)
            raw_areas = data.get("parking_areas", [])
            total_from_json = len(raw_areas)
    except Exception:
        pass

    # If camera not active, return zeros
    if not camera_active:
        return {
            "total": 0,
            "available": 0,
            "occupied": 0,
            "occupancy_rate": 0,
        }

    # Get live occupancy from DB
    slots = get_all_slots(db)
    status = {slot.id: slot.status for slot in slots}
    stats = get_parking_statistics(status)

    # Override total with saved slot count from SlotEditor
    stats["total"] = total_from_json
    # Recompute occupancy rate based on correct total
    occupied = stats.get("occupied", 0)
    available = max(0, total_from_json - occupied)
    stats["available"] = available
    stats["occupancy_rate"] = round((occupied / total_from_json) * 100, 2) if total_from_json > 0 else 0
    return stats

@app.get("/parking/history")
def get_parking_history(limit: int = 50, db: Session = Depends(get_db)):
    """
    Get parking history logs.
    """
    query = db.query(ParkingHistory).order_by(ParkingHistory.timestamp.desc())
    logs = query.limit(limit).all()
    result = [
        {
            "id": log.id,
            "slot_id": log.slot_id,
            "timestamp": (log.timestamp.isoformat() + "Z") if log.timestamp else None,
            "status": log.status,
            "entry_time": (log.timestamp.isoformat() + "Z") if log.status == "occupied" and log.timestamp else None,
            "exit_time": (log.timestamp.isoformat() + "Z") if log.status == "available" and log.timestamp else None,
            "duration_minutes": log.dwell_minutes,
            "vehicle_type": log.vehicle_type,
            "plate": log.plate,
            "speed_kmh": log.speed_kmh,
        } for log in logs
    ]
    return {"history": result}

@app.get("/lpr/history")
def get_lpr_history(limit: int = 50, plate: str = None, db: Session = Depends(get_db)):
    """
    Get LPR logs, optionally filtered by plate.
    """
    query = db.query(PlateLog).order_by(PlateLog.timestamp.desc())
    if plate:
        query = query.filter(PlateLog.plate == plate)
    logs = query.limit(limit).all()
    result = [
        {
            "id": log.id,
            "plate": log.plate,
            "slot_id": log.slot_id,
            "event_type": log.event_type,
            "timestamp": log.timestamp.isoformat() + "Z" if log.timestamp else None,
            "confidence": log.confidence,
            "vehicle_type": log.vehicle_type
        } for log in logs
    ]
    return {"logs": result}

@app.get("/revenue/summary")
def get_revenue_summary(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    today_total = db.query(Transaction).filter(Transaction.entry_time >= today_start).with_entities(Transaction.amount).all()
    week_total = db.query(Transaction).filter(Transaction.entry_time >= week_start).with_entities(Transaction.amount).all()
    month_total = db.query(Transaction).filter(Transaction.entry_time >= month_start).with_entities(Transaction.amount).all()
    total_amount = db.query(Transaction.amount).all()
    total_vehicles = len(total_amount)
    avg_per_vehicle = sum(a[0] for a in total_amount) / total_vehicles if total_vehicles > 0 else 0

    return {
        "today": round(sum(a[0] for a in today_total), 2),
        "week": round(sum(a[0] for a in week_total), 2),
        "month": round(sum(a[0] for a in month_total), 2),
        "avg_per_vehicle": round(avg_per_vehicle, 2)
    }

@app.get("/revenue/transactions")
def get_revenue_transactions(limit: int = 20, page: int = 1, date: str = None, db: Session = Depends(get_db)):
    query = db.query(Transaction).order_by(Transaction.entry_time.desc())
    if date:
        date_obj = datetime.fromisoformat(date)
        query = query.filter(Transaction.entry_time >= date_obj, Transaction.entry_time < date_obj + timedelta(days=1))
    total = query.count()
    transactions = query.offset((page - 1) * limit).limit(limit).all()
    result = [
        {
            "time": t.entry_time.isoformat() + "Z" if t.entry_time else None,
            "plate": t.plate,
            "slot": t.slot_id,
            "type": t.vehicle_type,
            "duration": _format_duration_minutes(t.duration_mins, t.entry_time, t.exit_time),
            "duration_minutes": _derive_duration_minutes(t.duration_mins, t.entry_time, t.exit_time),
            "amount": t.amount,
            "status": t.status
        } for t in transactions
    ]
    return {"transactions": result, "total": total, "page": page, "limit": limit}

@app.get("/revenue/chart")
def get_revenue_chart(range: str = "7d", db: Session = Depends(get_db)):
    days = 7 if range == "7d" else 30
    start_date = datetime.utcnow() - timedelta(days=days)
    from sqlalchemy import func
    daily_totals = db.query(
        func.date(Transaction.entry_time).label('date'),
        func.sum(Transaction.amount).label('total')
    ).filter(Transaction.entry_time >= start_date).group_by(func.date(Transaction.entry_time)).all()
    result = [{"date": str(d[0]), "total": float(d[1])} for d in daily_totals]
    return {"data": result}

@app.get("/analytics/dwell")
def get_dwell_summary(db: Session = Depends(get_db)):
    dwells = db.query(ParkingSession.duration_minutes).filter(ParkingSession.duration_minutes.isnot(None)).all()
    if not dwells:
        return {"avg_dwell": 0, "median_dwell": 0, "max_dwell": 0, "most_common": 0}
    values = [d[0] for d in dwells]
    avg = sum(values) / len(values)
    median = sorted(values)[len(values) // 2]
    max_dwell = max(values)
    most_common = max(set(values), key=values.count)
    return {
        "avg_dwell": round(avg, 2),
        "median_dwell": round(median, 2),
        "max_dwell": round(max_dwell, 2),
        "most_common": round(most_common, 2)
    }

@app.get("/analytics/dwell/chart")
def get_dwell_chart(zone: str = None, range: str = "7d", db: Session = Depends(get_db)):
    days = 7 if range == "7d" else 30
    start_date = datetime.utcnow() - timedelta(days=days)
    from sqlalchemy import func
    session_time = func.coalesce(ParkingSession.exit_time, ParkingSession.entry_time)
    query = db.query(
        func.extract('hour', session_time).label('hour'),
        func.avg(ParkingSession.duration_minutes).label('avg_dwell')
    ).filter(ParkingSession.duration_minutes.isnot(None), session_time >= start_date)
    if zone:
        query = query.filter(ParkingSession.slot_id.like(f"{zone}%"))
    hourly_avgs = query.group_by(func.extract('hour', session_time)).all()
    result = [{"hour": int(h[0]), "avg_dwell": float(h[1])} for h in hourly_avgs]
    return {"data": result}

@app.get("/analytics/occupancy-history")
def get_occupancy_history(limit: int = 100, db: Session = Depends(get_db)):
    """
    Get occupancy history for charting.
    """
    history = db.query(OccupancyHistory).order_by(OccupancyHistory.timestamp.desc()).limit(limit).all()
    result = [{"time": h.timestamp.isoformat() + "Z", "occupancy": h.occupancy_rate} for h in history]
    return {"data": result[::-1]}


@app.get("/parking/occupancy-history")
async def get_parking_occupancy_history(limit: int = 120, db: Session = Depends(get_db)):
    """
    Occupancy history for dashboard charting (roughly last 1 hour at 30s cadence).
    """
    history = (
        db.query(OccupancyHistory)
        .order_by(OccupancyHistory.timestamp.desc())
        .limit(limit)
        .all()
    )
    return {"data": [{"time": h.timestamp.isoformat() + "Z", "occupancy": h.occupancy_rate} for h in history][::-1]}


@app.get("/analytics/heatmap")
def get_analytics_heatmap(range: str = "30d", db: Session = Depends(get_db)):
    """
    Return an occupancy heatmap per zone per hour.
    Currently uses a placeholder implementation in heatmap.py.
    """
    days = 7 if range == "7d" else 30
    matrix = get_heatmap(range_days=days)
    return {"matrix": matrix}

@app.post("/export/trigger")
def trigger_export(db: Session = Depends(get_db)):
    try:
        from .scheduler import export_daily_report
    except ImportError:
        from scheduler import export_daily_report
    result = export_daily_report()
    return result

@app.get("/export/download")
def download_export(db: Session = Depends(get_db)):
    """Generate and download the current CSV report."""
    try:
        from .reporting import build_csv_report, collect_report_data
    except ImportError:
        from reporting import build_csv_report, collect_report_data

    report = collect_report_data(db)
    content = build_csv_report(report)
    filename = f'report_{report["date_str"]}.csv'
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/export/history")
def get_export_history(db: Session = Depends(get_db)):
    history = db.query(ExportHistory).order_by(ExportHistory.timestamp.desc()).all()
    result = [
        {
            "filename": h.filename,
            "file_size": h.file_size,
            "destination": h.destination,
            "timestamp": h.timestamp.isoformat() + "Z" if h.timestamp else None
        } for h in history
    ]
    return {"history": result}


@app.get("/export/report/pdf")
def export_report_pdf(db: Session = Depends(get_db)):
    try:
        from .reporting import build_pdf_report, collect_report_data
    except ImportError:
        from reporting import build_pdf_report, collect_report_data

    data = collect_report_data(db)
    content = build_pdf_report(data)
    date_str = data["date_str"]
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=SmartParking_Report_{date_str}.pdf"}
    )


@app.get("/export/report/excel")
def export_report_excel(db: Session = Depends(get_db)):
    try:
        from .reporting import build_excel_report, collect_report_data
    except ImportError:
        from reporting import build_excel_report, collect_report_data

    data = collect_report_data(db)
    content = build_excel_report(data)
    date_str = data["date_str"]
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=SmartParking_Report_{date_str}.xlsx"}
    )


@app.post("/export/report/email")
def export_report_email(db: Session = Depends(get_db)):
    """Generate report and send via email."""
    try:
        from .scheduler import export_daily_report
    except ImportError:
        from scheduler import export_daily_report
    result = export_daily_report()
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return {"message": "Report generated and emailed", "filename": result.get("filename", "")}


@app.get("/alerts")
def get_alerts(limit: int = 50, resolved: bool = None, db: Session = Depends(get_db)):
    """Get alerts, optionally filtered by resolved status."""
    query = db.query(Alert).order_by(Alert.timestamp.desc())
    if resolved is not None:
        query = query.filter(Alert.resolved == resolved)
    alerts = query.limit(limit).all()
    return {
        "alerts": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "slot_id": a.slot_id,
                "vehicle_id": a.vehicle_id,
                "detail": a.detail,
                "resolved": a.resolved,
                "timestamp": a.timestamp.isoformat() + "Z" if a.timestamp else None,
            }
            for a in alerts
        ]
    }

@app.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    """Mark an alert as resolved."""
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.resolved = True
    db.commit()
    return {"message": "Alert resolved"}

@app.get("/settings")
def get_settings():
    with open(_SETTINGS_PATH, 'r') as f:
        return json.load(f)

@app.put("/settings")
def update_settings(data: dict):
    with open(_SETTINGS_PATH, 'w') as f:
        json.dump(data, f)
    return {"message": "Settings updated"}
