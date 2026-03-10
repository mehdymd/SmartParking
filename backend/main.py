from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import cv2
from ultralytics import solutions
from .api import app as api_app
from .database import create_tables, initialize_slots, SessionLocal, update_slot_status
import time
reload_flag = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_tables()
    db = SessionLocal()
    try:
        # Initialize slots in database (6 slots)
        for i in range(6):
            slot_id = f'slot{i+1}'
            # Check if exists
            from .database import ParkingSlot
            if not db.query(ParkingSlot).filter(ParkingSlot.id == slot_id).first():
                slot = ParkingSlot(id=slot_id, status="available")
                db.add(slot)
        db.commit()
    finally:
        db.close()
    
    # Start background video processing task
    video_task = asyncio.create_task(process_video())
    
    yield
    
    # Shutdown
    video_task.cancel()
    try:
        await video_task
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_app.router)

async def process_video():
    """
    Background task to process video stream and update parking status using Ultralytics ParkingManagement.
    """
    current_source = Config.VIDEO_SOURCE
    cap = cv2.VideoCapture(current_source)
    if not cap.isOpened():
        print(f"Error: Cannot open video source {current_source}")
        return
    
    # Initialize ParkingManagement
    parkingmanager = solutions.ParkingManagement(
        model=Config.YOLO_MODEL_PATH,
        json_file=Config.PARKING_SLOTS_JSON
    )
    
    frame_count = 0
    while True:
        # Check if source changed
        if Config.VIDEO_SOURCE != current_source:
            cap.release()
            current_source = Config.VIDEO_SOURCE
            cap = cv2.VideoCapture(current_source)
            if not cap.isOpened():
                print(f"Error: Cannot open video source {current_source}")
                continue
            frame_count = 0  # Reset frame count
        
        ret, frame = cap.read()
        if not ret:
            print("Video stream ended or error reading frame")
            break
        
        frame_count += 1
        if frame_count % Config.FRAME_SKIP != 0:
            continue
        
        # Check for reload
        reload_path = Config.PARKING_SLOTS_JSON.replace('parking_slots.json', 'reload.txt')
        if os.path.exists(reload_path):
            os.remove(reload_path)
            parkingmanager = solutions.ParkingManagement(
                model=Config.YOLO_MODEL_PATH,
                json_file=Config.PARKING_SLOTS_JSON
            )
            print("Reloaded parking slots")
        
        # Process frame with ParkingManagement
        results = parkingmanager(frame)
        
        # Extract occupancy status (assuming results is a list with 'occupied' key for each area)
        # Note: This is based on typical Ultralytics output; adjust if actual format differs
        if hasattr(results, '__len__') and len(results) > 0:
            db = SessionLocal()
            try:
                for i, result in enumerate(results):
                    slot_id = f'slot{i+1}'
                    # Assuming result has 'occupied' boolean
                    status = 'occupied' if result.get('occupied', False) else 'available'
                    update_slot_status(db, slot_id, status)
            except Exception as e:
                print(f"Error processing results: {e}")
            finally:
                db.close()
        
        # Small delay to prevent overloading
        await asyncio.sleep(0.1)
    
    cap.release()
