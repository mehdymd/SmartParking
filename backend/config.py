import os

# Configuration settings for the Smart Parking Management System

class Config:
    # Database
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:Mehdy123@localhost:5435/parking_db")
    
    # YOLO Model
    YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
    
    # Parking Slots
    PARKING_SLOTS_JSON = os.path.join(os.path.dirname(__file__), "../data/parking_slots.json")
    
    # Video Source
    VIDEO_SOURCE = os.getenv("VIDEO_SOURCE", None)  # 0 for webcam, or path to video file
    
    # Occupancy Threshold
    IOU_THRESHOLD = float(os.getenv("IOU_THRESHOLD", "0.3"))
    
    # Frame Processing
    FRAME_SKIP = int(os.getenv("FRAME_SKIP", "5"))  # Process every 5th frame

    # Parking Management Parameters
    TRACKER = os.getenv("TRACKER", "botsort.yaml")
    CONF = float(os.getenv("CONF", "0.1"))
    IOU = float(os.getenv("IOU", "0.7"))
    DEVICE = os.getenv("DEVICE", None)
    SHOW = os.getenv("SHOW", False)
    LINE_WIDTH = os.getenv("LINE_WIDTH", None)

    # Alert Threshold
    ALERT_THRESHOLD = float(os.getenv("ALERT_THRESHOLD", "0.9"))

    # Alert Threshold
    ALERT_THRESHOLD = float(os.getenv("ALERT_THRESHOLD", "0.9"))
