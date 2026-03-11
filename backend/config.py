import os

# Configuration settings for the Smart Parking Management System

class Config:
    # Database
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:Mehdy123@localhost:5435/parking_db")
    
    # YOLO Model
    YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
    
    # Parking Slots
    SLOTS_DIR = os.path.join(os.path.dirname(__file__), "../data")
    PARKING_SLOTS_JSON = os.path.join(SLOTS_DIR, "parking_slots.json")  # default / uploaded
    PARKING_SLOTS_JSON_WEBCAM = os.path.join(SLOTS_DIR, "parking_slots_webcam.json")
    
    # Video Source
    _raw_video_source = os.getenv("VIDEO_SOURCE", None)
    # Default to local webcam (0) unless explicitly overridden.
    if _raw_video_source is None or _raw_video_source == "":
        VIDEO_SOURCE = 0
    else:
        # Normalize common webcam spec.
        VIDEO_SOURCE = 0 if _raw_video_source == "0" else _raw_video_source
    
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
