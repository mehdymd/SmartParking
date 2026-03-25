import os

# Configuration settings for the Smart Parking Management System


def _load_env_files():
    backend_dir = os.path.dirname(__file__)
    project_root = os.path.abspath(os.path.join(backend_dir, ".."))
    candidates = [
        os.path.join(project_root, ".env"),
        os.path.join(backend_dir, ".env"),
    ]

    for env_path in candidates:
        if not os.path.exists(env_path):
            continue
        try:
            with open(env_path, "r", encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
        except OSError:
            continue


_load_env_files()


class Config:
    _backend_dir = os.path.dirname(__file__)

    # Database
    DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(_backend_dir, 'parking_local.db')}")
    
    # YOLO Model
    YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
    
    # Parking Slots
    SLOTS_DIR = os.path.join(_backend_dir, "../data")
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
    FRAME_SKIP = int(os.getenv("FRAME_SKIP", "3"))  # Process every 3rd frame

    # Parking Management Parameters
    TRACKER = os.getenv("TRACKER", "botsort.yaml")
    CONF = float(os.getenv("CONF", "0.1"))
    IOU = float(os.getenv("IOU", "0.7"))
    DEVICE = os.getenv("DEVICE", None)
    SHOW = os.getenv("SHOW", False)
    LINE_WIDTH = os.getenv("LINE_WIDTH", None)

    # Alert Threshold
    ALERT_THRESHOLD = float(os.getenv("ALERT_THRESHOLD", "0.9"))
