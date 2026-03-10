from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import cv2
import os
from ultralytics import solutions
from api import app as api_app
from database import create_tables, initialize_slots, SessionLocal, update_slot_status
from config import Config
reload_flag = False
annotated_url = None

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
        
        if current_source != '0':
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            height, width = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            out = cv2.VideoWriter(f'videos/annotated_{os.path.basename(current_source)}', fourcc, 30, (width, height))
            annotated_url = f'/videos/annotated_{os.path.basename(current_source)}'
        else:
            out = None
            annotated_url = None
        
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
                    break
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
                        stats[slot_id] = status
                except Exception as e:
                    print(f"Error processing results: {e}")
                finally:
                    db.close()
            
                data = {
                    "status": status,
                    "stats": stats,
                    "timestamp": "current",
                    "annotated_url": annotated_url
                }
            
            if out:
                if results:
                    for result in results:
                        if 'bbox' in result:
                            x1, y1, x2, y2 = result['bbox']
                            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                out.write(frame)
            
            # Small delay to prevent overloading
            await asyncio.sleep(0.1)
        
        cap.release()
        if out:
            out.release()
