from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from database import get_db, get_all_slots, ParkingHistory, PlateLog, Transaction, ExportHistory
from parking_logic import get_parking_statistics
from config import Config
from datetime import datetime, timedelta
import json
import os
import base64
from PIL import Image
import io
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
        Config.VIDEO_SOURCE = f"videos/{filename}"
        return {"message": f"Video {filename} uploaded successfully", "url": f"/videos/{filename}"}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

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
    """Update parking slots JSON with user annotations."""
    parking_slots = data.get('parking_slots', [])
    json_data = {"parking_areas": parking_slots}
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
    """Get the current parking slot polygons."""
    try:
        with open(Config.PARKING_SLOTS_JSON, 'r') as f:
            data = json.load(f)
        return {"polygons": data.get("parking_areas", [])}
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

@app.get("/analytics/heatmap")
def get_analytics_heatmap(range: str = "30d", db: Session = Depends(get_db)):
    days = 7 if range == "7d" else 30
    matrix = get_heatmap(days)
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
