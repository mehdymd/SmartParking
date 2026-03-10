import cv2
import numpy as np
from collections import deque

PIXELS_PER_METER = 8.0
SPEED_LIMIT_KMH  = 10.0
SPEED_ALERT_KMH  = 15.0

def estimate_speed(prev_gray, curr_gray, bbox, fps):
    x1,y1,x2,y2 = bbox
    crop_prev = prev_gray[y1:y2, x1:x2]
    crop_curr = curr_gray[y1:y2, x1:x2]
    pts = cv2.goodFeaturesToTrack(crop_prev, 50, 0.3, 7)
    if pts is None:
        return None
    pts_next, status, _ = cv2.calcOpticalFlowPyrLK(crop_prev, crop_curr, pts, None)
    good = pts_next[status.flatten() == 1] - pts[status.flatten() == 1]
    if len(good) == 0:
        return None
    avg_disp = np.mean(np.linalg.norm(good, axis=1))
    speed_mps = (avg_disp / PIXELS_PER_METER) * fps
    return round(speed_mps * 3.6, 1)   # km/h
