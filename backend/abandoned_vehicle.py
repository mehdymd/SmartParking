from datetime import datetime, timedelta
import asyncio

ABANDONED_THRESHOLD_MINUTES = 120
CHECK_INTERVAL_SECONDS = 60

active_vehicles = {}   # slot_id → {vehicle_id, entry_time, vehicle_type}

async def check_abandoned(websocket_broadcast_fn):
    while True:
        now = datetime.utcnow()
        for slot_id, info in active_vehicles.items():
            delta = (now - info['entry_time']).total_seconds() / 60
            if delta > ABANDONED_THRESHOLD_MINUTES:
                await websocket_broadcast_fn({
                    "type": "abandoned_alert",
                    "slot_id": slot_id,
                    "vehicle_id": info['vehicle_id'],
                    "duration_mins": int(delta)
                })
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
