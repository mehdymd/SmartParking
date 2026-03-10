import numpy as np

ENTRY_ZONES = [{"id": "entry_1", "bbox": [0,0,100,480], "expected_vector": [1, 0]}]
EXIT_ZONES  = [{"id": "exit_1",  "bbox": [540,0,640,480], "expected_vector": [-1, 0]}]
WRONG_WAY_ANGLE_THRESHOLD = 120   # degrees
WRONG_WAY_MIN_FRAMES = 5

def check_wrong_way(vehicle_id, centroid_history):
    if len(centroid_history) < WRONG_WAY_MIN_FRAMES + 1:
        return False
    motion = np.array(centroid_history[-1]) - np.array(centroid_history[-WRONG_WAY_MIN_FRAMES])
    for zone in ENTRY_ZONES + EXIT_ZONES:
        expected = np.array(zone['expected_vector'])
        cos_angle = np.dot(motion, expected) / (np.linalg.norm(motion) * np.linalg.norm(expected) + 1e-6)
        angle = np.degrees(np.arccos(np.clip(cos_angle, -1, 1)))
        if angle > WRONG_WAY_ANGLE_THRESHOLD:
            return zone['id']
    return False
