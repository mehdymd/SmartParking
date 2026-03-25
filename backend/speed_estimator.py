import cv2
import numpy as np

PIXELS_PER_METER = 8.0
SPEED_LIMIT_KMH = 10.0
SPEED_ALERT_KMH = 15.0


def estimate_speed(prev_gray, curr_gray, bbox, fps):
    """
    Estimate vehicle speed using optical flow between two consecutive grayscale frames.
    Returns speed in km/h or None if estimation fails.
    """
    if prev_gray is None or curr_gray is None:
        return None
    try:
        x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
        # Clamp to frame bounds
        h, w = prev_gray.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 - x1 < 10 or y2 - y1 < 10:
            return None

        crop_prev = prev_gray[y1:y2, x1:x2]
        crop_curr = curr_gray[y1:y2, x1:x2]
        if crop_prev.size == 0 or crop_curr.size == 0:
            return None

        pts = cv2.goodFeaturesToTrack(crop_prev, 50, 0.3, 7)
        if pts is None or len(pts) == 0:
            return None

        pts_next, status, _ = cv2.calcOpticalFlowPyrLK(crop_prev, crop_curr, pts, None)
        if pts_next is None or status is None:
            return None

        good_mask = status.flatten() == 1
        if not np.any(good_mask):
            return None

        good = pts_next[good_mask] - pts[good_mask]
        if len(good) == 0:
            return None

        avg_disp = np.mean(np.linalg.norm(good, axis=1))
        speed_mps = (avg_disp / PIXELS_PER_METER) * fps
        return round(speed_mps * 3.6, 1)  # km/h
    except Exception:
        return None
