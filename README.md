# Smart Parking Management System

A complete computer vision-based smart parking management system using YOLOv8 for vehicle detection and occupancy analysis. The system provides real-time parking space monitoring with a web dashboard for visualization and statistics.

## Features

- **Real-time Vehicle Detection**: Uses YOLOv8 to detect vehicles (cars, trucks, buses, motorcycles) from video streams
- **Parking Space Occupancy Detection**: Determines if parking spaces are occupied using bounding box overlap (IoU)
- **Web Dashboard**: React-based dashboard with live updates via WebSockets
- **Statistics**: Real-time parking statistics including total spaces, occupied/available counts, and occupancy rate
- **Historical Data**: Stores parking status changes in database for analysis
- **Modular Architecture**: Clean, modular code suitable for academic projects
- **API Endpoints**: RESTful API for status, statistics, and historical data

## Technology Stack

### Backend
- Python 3.8+
- FastAPI (web framework)
- OpenCV (video processing)
- Ultralytics YOLOv8 (vehicle detection)
- PyTorch (deep learning)
- SQLAlchemy (database ORM)
- SQLite (database, can be changed to PostgreSQL)

### Frontend
- React.js (UI framework)
- Chart.js (data visualization)
- WebSockets (real-time updates)

## Project Structure

```
parking-system/
├── backend/
│   ├── main.py          # Main application entry point
│   ├── detector.py      # YOLOv8 vehicle detection module
│   ├── parking_logic.py # Occupancy detection and statistics
│   ├── database.py      # Database models and operations
│   ├── api.py           # FastAPI routes and WebSocket
│   └── config.py        # Configuration settings
├── models/
│   └── yolov8_model.pt  # YOLOv8 model (downloaded automatically)
├── data/
│   └── parking_slots.json # Parking space coordinates
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.js       # Main React component
│   │   ├── App.css      # Styles
│   │   └── index.js     # React entry point
│   └── package.json     # Frontend dependencies
├── scripts/
│   └── train_yolov8.py  # Training script (optional)
├── requirements.txt     # Python dependencies
└── README.md            # This file
```

## Installation

### Prerequisites
- Python 3.8 or higher
- Node.js 14 or higher
- pip (Python package manager)
- npm (Node.js package manager)

### Backend Setup

1. **Clone or navigate to the project directory**
   ```bash
   cd /path/to/yolov8
   ```

2. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure the system** (optional)
   - Edit `backend/config.py` to change settings like video source, IoU threshold, etc.
   - Modify `data/parking_slots.json` to match your parking lot layout

### Frontend Setup

1. **Install Node.js dependencies**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

## Configuration

### Video Source
Set the video source in `backend/config.py`:
- `"0"` for webcam
- Path to video file (e.g., `"parking_lot.mp4"`)
- RTSP URL for CCTV streams

### Parking Slots
Define parking spaces in `data/parking_slots.json`:
```json
[
    {
        "id": "slot1",
        "bbox": [x1, y1, x2, y2]
    }
]
```
Coordinates should match the video frame dimensions.

### Other Settings
- `IOU_THRESHOLD`: Minimum IoU for occupancy detection (default: 0.3)
- `FRAME_SKIP`: Process every Nth frame (default: 5)

## Running the System

### Start Backend
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Start Frontend
```bash
cd frontend
npm start
```

The dashboard will be available at `http://localhost:3000`

## API Endpoints

### REST Endpoints
- `GET /parking/status` - Current parking slot statuses
- `GET /parking/stats` - Parking statistics
- `GET /parking/history?limit=100` - Historical parking data

### WebSocket
- `ws://localhost:8000/ws/parking-updates` - Real-time updates

## Example Usage

1. Start the backend server
2. Ensure video source is configured correctly
3. Open the React dashboard in browser
4. View real-time parking status and statistics

## Database

The system uses SQLite by default (`parking.db`). To use PostgreSQL:
1. Install `psycopg2`
2. Change `DATABASE_URL` in `config.py`

## Training Custom Model (Optional)

If you need to train YOLOv8 for custom vehicle detection:
```bash
python scripts/train_yolov8.py
```
Modify the script with your dataset path and parameters.

## Troubleshooting

- **Video not opening**: Check video source path or camera permissions
- **Model not loading**: Ensure internet connection for first download
- **WebSocket errors**: Verify backend is running on correct port
- **Database errors**: Check file permissions for SQLite database

## License

This project is for academic purposes. Please cite appropriately if used in research.

## Contributing

This is a complete implementation. For modifications:
1. Backend changes in `backend/` directory
2. Frontend changes in `frontend/src/`
3. Update dependencies in respective requirement files
