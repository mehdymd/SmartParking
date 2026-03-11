from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from database import get_db, get_all_slots, ParkingHistory, PlateLog, Transaction, ExportHistory, OccupancyHistory, update_slot_status
from parking_logic import get_parking_statistics
from config import Config
from datetime import datetime, timedelta
import json
import os
import shutil
import uuid
import tempfile
import base64
import io
from PIL import Image
import numpy as np
import cv2
import sys
sys.path.append('../ultralytics_lib')
from ultralytics.models.yolo import YOLO
from heatmap import get_heatmap

# Load settings
with open('settings.json') as f:
    settings = json.load(f)

VIDEO_DIR = "videos"
os.makedirs(VIDEO_DIR, exist_ok=True)

yolo_model = None  # YOLO()

app = FastAPI(title="Smart Parking Management System")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    if not file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.jpg', '.png')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only video and image files are allowed.")
    
    temp_path = "uploaded_video.mp4"
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        # Point processing pipeline to this uploaded file
        Config.VIDEO_SOURCE = temp_path
        return {"source": temp_path}
    except Exception as e:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
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
        time.sleep(0.05)


@app.get("/parking/snapshot")
async def parking_snapshot():
    """
    Capture a single frame from the current video source and return it as a JPEG image.
    This is used by the slot editor to ensure polygons align with the active feed.
    """
    if not Config.VIDEO_SOURCE:
        raise HTTPException(status_code=404, detail="No active video source")

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

    if not Config.VIDEO_SOURCE:
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
        with open(Config.PARKING_SLOTS_JSON, 'r') as f:
            slots_data = json.load(f)
        parking_areas = slots_data.get('parking_areas', [])
    except Exception:
        parking_areas = []

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1

    frame_width = slots_data.get('frame_width') if 'slots_data' in locals() else None
    frame_height = slots_data.get('frame_height') if 'slots_data' in locals() else None

    if frame_width and frame_height:
        scale_x = width / frame_width
        scale_y = height / frame_height
    else:
        scale_x = scale_y = 1.0

    for area in parking_areas:
        points = []
        for p in area:
            # Support both dict {"x","y"} and [x, y] formats
            if isinstance(p, dict):
                x, y = p.get('x', 0), p.get('y', 0)
            else:
                x, y = p[0], p[1]
            points.append((int(x * scale_x), int(y * scale_y)))
        if len(points) >= 2:
            parking_polygons.append(np.array(points, np.int32))

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                # Loop playback for file-based sources
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue

            # Draw parking slot polygons
            for poly in parking_polygons:
                cv2.polylines(frame, [poly], isClosed=True, color=(0, 255, 0), thickness=2)

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
        cap = cv2.VideoCapture(Config.VIDEO_SOURCE)
        is_open = cap.isOpened()
        if is_open:
            ret, _ = cap.read()
            is_open = ret
        cap.release()
        return {"active": is_open}
    except Exception as e:
        print(f"Camera status error: {e}")
        return {"active": False}

@app.post("/parking/set-source")
async def set_source(data: dict):
    """Set the video source at runtime (e.g., to webcam or file path)."""
    source = data.get('source')
    if source is None:
      Config.VIDEO_SOURCE = None
      return {"message": "Source cleared"}

    # Normalize webcam source
    if source == "0":
        source = 0

    try:
        cap = cv2.VideoCapture(source)
        valid = cap.isOpened()
        cap.release()
        if valid:
            Config.VIDEO_SOURCE = source
            return {"message": "Source updated successfully"}
        else:
            return {"error": "Source is invalid or not accessible"}
    except Exception as e:
        print(f"Set source error: {e}")
        return {"error": "Source validation failed"}

from pydantic import BaseModel

class DetectRequest(BaseModel):
    image: str

@app.post("/detect-frame")
async def detect_frame(request: DetectRequest):
    """Detect vehicles in a base64 encoded image and return image with bounding boxes."""
    image_data = base64.b64decode(request.image)
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    detections = yolo_model.predict(np.array(image))
    
    # Draw bounding boxes
    img_array = np.array(image)
    for det in detections:
        bbox = det['bbox']
        x1, y1, x2, y2 = map(int, bbox)
        cv2.rectangle(img_array, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(img_array, det['class'], (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    
    _, encoded_img = cv2.imencode('.jpg', cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR))
    img_base64 = base64.b64encode(encoded_img.tobytes()).decode('utf-8')
    return {"image": img_base64}

@app.post("/update-parking-slots")
async def update_parking_slots(data: dict):
    """
    Update the parking slots configuration.
    """
    parking_slots = data.get('parking_slots', [])
    entry_zone = data.get('entry_zone')
    exit_zone = data.get('exit_zone')

    json_data = {"parking_areas": parking_slots}
    if 'frame_width' in data:
        json_data['frame_width'] = data['frame_width']
        json_data['frame_height'] = data['frame_height']

    # Optional global entry/exit zones for revenue/flow analytics
    if entry_zone is not None:
        json_data['entry_zone'] = entry_zone
    if exit_zone is not None:
        json_data['exit_zone'] = exit_zone
    
    os.makedirs(os.path.dirname(Config.PARKING_SLOTS_JSON), exist_ok=True)
    with open(Config.PARKING_SLOTS_JSON, 'w') as f:
        json.dump(json_data, f)
    
    # Trigger reload
    reload_path = Config.PARKING_SLOTS_JSON.replace('parking_slots.json', 'reload.txt')
    with open(reload_path, 'w') as f:
        f.write('1')
    
    return {"message": "Parking slots updated successfully. Changes applied directly."}

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
    """Get the current parking slot polygons and optional entry/exit zones."""
    try:
        with open(Config.PARKING_SLOTS_JSON, 'r') as f:
            data = json.load(f)
        return {
            "polygons": data.get("parking_areas", []),
            "entry_zone": data.get("entry_zone"),
            "exit_zone": data.get("exit_zone")
        }
    except:
        return {"polygons": []}

@app.get("/parking/stats")
def get_parking_stats(db: Session = Depends(get_db)):
    """
    Get parking statistics.
    """
    slots = get_all_slots(db)
    status = {slot.id: slot.status for slot in slots}
    stats = get_parking_statistics(status)
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
            "entry_time": log.entry_time.isoformat() if log.entry_time else None,
            "exit_time": log.exit_time.isoformat() if log.exit_time else None,
            "duration_minutes": log.duration_mins,
            "vehicle_type": log.vehicle_type,
            "plate": log.plate
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
            "timestamp": log.timestamp.isoformat(),
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
            "time": t.entry_time.isoformat(),
            "plate": t.plate,
            "slot": t.slot_id,
            "type": t.vehicle_type,
            "duration": f"{t.duration_mins // 60}h {t.duration_mins % 60}m" if t.duration_mins else "N/A",
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
    dwells = db.query(ParkingHistory.dwell_minutes).filter(ParkingHistory.dwell_minutes.isnot(None)).all()
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
    query = db.query(
        func.extract('hour', ParkingHistory.timestamp).label('hour'),
        func.avg(ParkingHistory.dwell_minutes).label('avg_dwell')
    ).filter(ParkingHistory.dwell_minutes.isnot(None), ParkingHistory.timestamp >= start_date)
    if zone:
        query = query.filter(ParkingHistory.slot_id.startswith(zone))
    hourly_avgs = query.group_by(func.extract('hour', ParkingHistory.timestamp)).all()
    result = [{"hour": int(h[0]), "avg_dwell": float(h[1])} for h in hourly_avgs]
    return {"data": result}

@app.get("/analytics/occupancy-history")
def get_occupancy_history(limit: int = 100, db: Session = Depends(get_db)):
    """
    Get occupancy history for charting.
    """
    history = db.query(OccupancyHistory).order_by(OccupancyHistory.timestamp.desc()).limit(limit).all()
    result = [{"time": h.timestamp.isoformat(), "occupancy": h.occupancy_rate} for h in history]
    return {"data": result[::-1]}


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
    from scheduler import export_daily_report
    export_daily_report()
    return {"message": "Export triggered"}

@app.get("/export/history")
def get_export_history(db: Session = Depends(get_db)):
    history = db.query(ExportHistory).order_by(ExportHistory.timestamp.desc()).all()
    result = [
        {
            "filename": h.filename,
            "file_size": h.file_size,
            "destination": h.destination,
            "timestamp": h.timestamp.isoformat()
        } for h in history
    ]
    return {"history": result}

@app.get("/settings")
def get_settings():
    with open('settings.json', 'r') as f:
        return json.load(f)

@app.put("/settings")
def update_settings(data: dict):
    with open('settings.json', 'w') as f:
        json.dump(data, f)
    return {"message": "Settings updated"}

# WebSocket for real-time updates
from fastapi import WebSocket
import asyncio

@app.websocket("/ws/parking-updates")
async def websocket_parking_updates(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()
    try:
        while True:
            slots = get_all_slots(db)
            status = {slot.id: slot.status for slot in slots}
            stats = get_parking_statistics(status)
            data = {
                "status": status,
                "stats": stats,
                "timestamp": "current"
            }
            await websocket.send_json(data)
            await asyncio.sleep(1)  # Send updates every second
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await websocket.close()
