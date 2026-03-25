import numpy as np
import json
import os

WRONG_WAY_ANGLE_THRESHOLD = 120  # degrees
WRONG_WAY_MIN_FRAMES = 5


def _load_zones_from_settings():
    """
    Load expected entry/exit vectors from parking slots JSON if available.
    Falls back to hardcoded defaults.
    """
    defaults = {
        "entry": {"expected_vector": [1, 0]},
        "exit": {"expected_vector": [-1, 0]},
    }
    try:
        data_dir = os.path.join(os.path.dirname(__file__), "../data")
        slots_path = os.path.join(data_dir, "parking_slots.json")
        if not os.path.exists(slots_path):
            return defaults
        with open(slots_path) as f:
            data = json.load(f)
        entry = data.get("entry_zone")
        exit_ = data.get("exit_zone")
        if entry and len(entry) >= 2:
            # Compute centroid of entry zone and derive expected direction
            cx = sum(p["x"] for p in entry) / len(entry)
            cy = sum(p["y"] for p in entry) / len(entry)
            # Default: vehicles move rightward (positive x) through entry
            defaults["entry"] = {"expected_vector": [1, 0], "centroid": [cx, cy]}
        if exit_ and len(exit_) >= 2:
            cx = sum(p["x"] for p in exit_) / len(exit_)
            cy = sum(p["y"] for p in exit_) / len(exit_)
            defaults["exit"] = {"expected_vector": [-1, 0], "centroid": [cx, cy]}
    except Exception:
        pass
    return defaults


def check_wrong_way(vehicle_id, centroid_history):
    """
    Check if a vehicle is moving in the wrong direction based on its centroid history.
    Returns zone_id string if wrong-way detected, False otherwise.
    """
    if len(centroid_history) < WRONG_WAY_MIN_FRAMES + 1:
        return False

    zones = _load_zones_from_settings()

    motion = np.array(centroid_history[-1], dtype=float) - np.array(
        centroid_history[-WRONG_WAY_MIN_FRAMES], dtype=float
    )
    motion_norm = np.linalg.norm(motion)
    if motion_norm < 2.0:  # Not enough movement
        return False

    for zone_key, zone_info in zones.items():
        expected = np.array(zone_info["expected_vector"], dtype=float)
        cos_angle = np.dot(motion, expected) / (motion_norm * np.linalg.norm(expected) + 1e-6)
        angle = np.degrees(np.arccos(np.clip(cos_angle, -1, 1)))
        if angle > WRONG_WAY_ANGLE_THRESHOLD:
            return zone_key
    return False
