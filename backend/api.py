from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from .database import get_db, get_all_slots, ParkingHistory
from .parking_logic import get_parking_statistics
from .config import Config
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

VIDEO_DIR = "../videos"
os.makedirs(VIDEO_DIR, exist_ok=True)

yolo_model = YOLO()

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
    
    file_path = os.path.join(VIDEO_DIR, file.filename)
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    # Update config
    from .config import Config
    Config.VIDEO_SOURCE = file_path
    
    return {"message": f"Video {file.filename} uploaded successfully", "path": file_path}

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
def get_parking_history(limit: int = 100, db: Session = Depends(get_db)):
    """
    Get historical parking data.
    """
    history = db.query(ParkingHistory).order_by(ParkingHistory.timestamp.desc()).limit(limit).all()
    result = [
        {
            "slot_id": h.slot_id,
            "status": h.status,
            "timestamp": h.timestamp.isoformat()
        } for h in history
    ]
    return {"history": result}

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
