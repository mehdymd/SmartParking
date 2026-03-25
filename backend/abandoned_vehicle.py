from datetime import datetime
import asyncio
import json

ABANDONED_THRESHOLD_MINUTES = 120
CHECK_INTERVAL_SECONDS = 60

# slot_id -> {vehicle_id, entry_time, vehicle_type}
active_vehicles = {}


def register_vehicle(slot_id, vehicle_id, vehicle_type="unknown"):
    """Register a vehicle as active in a slot."""
    active_vehicles[slot_id] = {
        "vehicle_id": vehicle_id,
        "entry_time": datetime.utcnow(),
        "vehicle_type": vehicle_type,
    }


def unregister_vehicle(slot_id):
    """Remove a vehicle from active tracking."""
    active_vehicles.pop(slot_id, None)


def update_active_from_occupancy(occupancy_map, tracks_map):
    """
    Sync active_vehicles with current occupancy and track info.
    Called each frame from the main video loop.
    """
    # Build set of occupied slots with a track
    occupied_slots = set()
    for slot_id, state in occupancy_map.items():
        if state == "occupied":
            occupied_slots.add(slot_id)
            if slot_id not in active_vehicles:
                # Find first track near this slot (approximate)
                vid = f"auto-{slot_id}"
                register_vehicle(slot_id, vid, "unknown")

    # Unregister vehicles from slots that are now available
    for slot_id in list(active_vehicles.keys()):
        if slot_id not in occupied_slots:
            unregister_vehicle(slot_id)


async def check_abandoned_loop():
    """
    Background loop that checks for abandoned vehicles and persists alerts to DB.
    """
    while True:
        try:
            now = datetime.utcnow()
            for slot_id, info in list(active_vehicles.items()):
                delta_mins = (now - info["entry_time"]).total_seconds() / 60
                if delta_mins > ABANDONED_THRESHOLD_MINUTES:
                    # Log alert to DB
                    try:
                        from database import SessionLocal, Alert
                        db = SessionLocal()
                        try:
                            # Check if we already alerted for this slot recently
                            existing = (
                                db.query(Alert)
                                .filter(
                                    Alert.alert_type == "abandoned",
                                    Alert.slot_id == slot_id,
                                    Alert.resolved == False,
                                )
                                .first()
                            )
                            if not existing:
                                alert = Alert(
                                    alert_type="abandoned",
                                    slot_id=slot_id,
                                    vehicle_id=info["vehicle_id"],
                                    detail=json.dumps({
                                        "duration_mins": int(delta_mins),
                                        "vehicle_type": info.get("vehicle_type", "unknown"),
                                    }),
                                )
                                db.add(alert)
                                db.commit()
                                print(f"Abandoned alert: slot {slot_id}, vehicle {info['vehicle_id']}, {int(delta_mins)} min")
                        finally:
                            db.close()
                    except Exception as e:
                        print(f"Abandoned alert DB error: {e}")
        except Exception as e:
            print(f"Abandoned check error: {e}")

        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
