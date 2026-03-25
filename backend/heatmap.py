import json
import os
from datetime import datetime, timedelta


def _get_slots_path():
    try:
        from .config import Config
    except ImportError:
        from config import Config

    source = getattr(Config, "VIDEO_SOURCE", None)
    if source == 0 or source == "0":
        return Config.PARKING_SLOTS_JSON_WEBCAM
    return Config.PARKING_SLOTS_JSON


def _load_slot_zone_map():
    path = _get_slots_path()
    if not path or not os.path.exists(path):
        return {}

    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return {}

    mapping = {}
    for idx, area in enumerate(data.get("parking_areas") or []):
        slot_id = f"S{idx + 1}"
        if isinstance(area, dict):
            mapping[slot_id] = area.get("zone", "A") or "A"
        else:
            mapping[slot_id] = "A"
    return mapping


def get_heatmap(range_days=30):
    """
    Aggregate occupancy rates per zone per hour from ParkingHistory.
    Falls back to zeros if DB is unavailable.
    """
    try:
        try:
            from .database import SessionLocal, ParkingHistory
        except ImportError:
            from database import SessionLocal, ParkingHistory
        from sqlalchemy import func

        slot_zone_map = _load_slot_zone_map()
        db = SessionLocal()
        try:
            start_date = datetime.utcnow() - timedelta(days=range_days)

            # Query avg dwell per slot prefix (zone) per hour
            rows = (
                db.query(
                    ParkingHistory.slot_id.label("slot_id"),
                    func.extract("hour", ParkingHistory.timestamp).label("hour"),
                    func.count().label("events"),
                )
                .filter(
                    ParkingHistory.timestamp >= start_date,
                    ParkingHistory.status == "occupied",
                    ParkingHistory.slot_id.isnot(None),
                )
                .group_by(ParkingHistory.slot_id, "hour")
                .all()
            )

            # Also count total events per zone per hour for rate calculation
            total_rows = (
                db.query(
                    ParkingHistory.slot_id.label("slot_id"),
                    func.extract("hour", ParkingHistory.timestamp).label("hour"),
                    func.count().label("total"),
                )
                .filter(
                    ParkingHistory.timestamp >= start_date,
                    ParkingHistory.slot_id.isnot(None),
                )
                .group_by(ParkingHistory.slot_id, "hour")
                .all()
            )

            # Build totals lookup: (zone, hour) -> total_events
            totals = {}
            for r in total_rows:
                z = slot_zone_map.get(r.slot_id, "A") if r.slot_id else "A"
                h = int(r.hour) if r.hour is not None else 0
                totals[(z, h)] = totals.get((z, h), 0) + r.total

            # Build occupied lookup
            occupied = {}
            for r in rows:
                z = slot_zone_map.get(r.slot_id, "A") if r.slot_id else "A"
                h = int(r.hour) if r.hour is not None else 0
                occupied[(z, h)] = occupied.get((z, h), 0) + r.events

            # Compute rate per zone per hour
            zones = sorted(set(z for (z, _) in totals.keys()) | {"A", "B", "C"})
            matrix = {}
            for zone in zones:
                matrix[zone] = []
                for hour in range(24):
                    occ = occupied.get((zone, hour), 0)
                    tot = totals.get((zone, hour), 1)
                    rate = round(occ / tot, 2) if tot > 0 else 0.0
                    matrix[zone].append(rate)

            return matrix
        finally:
            db.close()
    except Exception as e:
        print(f"Heatmap aggregation error: {e}")
        # Fallback: return zeros
        return {z: [0.0] * 24 for z in ["A", "B", "C"]}
