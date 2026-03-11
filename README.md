

# Smart Parking Management System

A comprehensive Smart Parking Management System using AI-powered computer vision for real-time vehicle detection and parking space monitoring. Features a modern React dashboard with analytics, revenue tracking, live video feeds, and annotated output processing.

## Features

- **AI-Powered Vehicle Detection**: Uses YOLOv8 for real-time detection of vehicles in parking areas
- **Video Upload and Live Feed**: Upload videos for processing or connect to live camera feeds with annotated output
- **Real-Time Statistics**: Live dashboard with parking occupancy, available spaces, and rates
- **Analytics Dashboard**: Heatmaps, dwell time analysis, and occupancy patterns over time
- **Revenue Management**: Track parking revenue, transactions, and financial reports
- **License Plate Recognition (LPR)**: Vehicle identification and logging system
- **Navigation Map**: Interactive map for parking lot navigation
- **WebSocket Updates**: Real-time data updates across the application
- **Responsive UI**: Modern glassmorphism design with mobile support
- **PostgreSQL Database**: Robust data storage for statistics, history, and analytics
- **Modular Architecture**: Clean, scalable code suitable for production use

## Technology Stack

### Backend
- Python 3.8+
- FastAPI (web framework)
- OpenCV (video processing)
- Ultralytics YOLOv8 (vehicle detection)
- SQLAlchemy (database ORM)
- PostgreSQL (database)
- APScheduler (background tasks)
- WebSockets (real-time updates)

### Frontend
- React.js with Hooks (UI framework)
- CSS Variables for glassmorphism theming
- Lucide React (icons)
- React-Leaflet (mapping)
- WebSockets (real-time updates)

## Project Structure

```
yolov8/
├── backend/
│   ├── main.py          # FastAPI app with WebSocket and video processing
│   ├── api.py           # API endpoints for stats, upload, analytics
│   ├── database.py      # SQLAlchemy models and database operations
│   ├── config.py        # Configuration settings
│   ├── tracker.py       # Object tracking logic
│   └── scheduler.py     # Background task scheduling
├── frontend/
│   ├── src/
│   │   ├── App.js       # Main app component
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   ├── LiveFeed.jsx
│   │   ├── Controls.jsx
│   │   ├── StatsPanel.jsx
│   │   ├── ActivityLog.jsx
│   │   └── pages/
│   │       ├── Dashboard.jsx
│   │       ├── AnalyticsPage.jsx
│   │       ├── LPRPage.jsx
│   │       └── RevenuePage.jsx
│   │   └── index.js     # React entry point
│   └── package.json     # Frontend dependencies
├── ultralytics_lib/    # Ultralytics library
├── data/
│   └── parking_slots.json # Parking area coordinates
├── videos/              # Uploaded and processed videos
├── yolov8n.pt           # YOLOv8 model
├── requirements.txt     # Python dependencies
└── README.md            # This file
```

## Installation

### Prerequisites
- Python 3.8 or higher
- Node.js 14 or higher
- PostgreSQL database
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

3. **Set up PostgreSQL database**
   - Create a database: `createdb parking_db`
   - Set environment variable: `export DATABASE_URL=postgresql://username:password@localhost/parking_db`

4. **Configure the system** (optional)
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

The frontend will run on http://localhost:3001, backend on http://localhost:8000

## API Endpoints

### REST Endpoints
- `GET /parking/stats` - Real-time parking statistics
- `GET /parking/history?limit=50` - Parking history
- `POST /upload-video` - Upload video for processing
- `GET /analytics/heatmap?range=30d` - Occupancy heatmap data
- `GET /analytics/dwell` - Dwell time analytics
- `GET /revenue/summary` - Revenue summary
- `GET /revenue/transactions?page=1` - Revenue transactions
- `GET /lpr/logs?limit=50` - LPR logs

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

