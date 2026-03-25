import json

try:
    from .database import load_parking_slots_from_json
except ImportError:
    from database import load_parking_slots_from_json

VEHICLE_CLASS_MAP = {
    'car':        {'type': 'standard', 'size': 1},
    'motorcycle': {'type': 'compact',  'size': 0.5},
    'truck':      {'type': 'large',    'size': 2},
    'bus':        {'type': 'large',    'size': 2},
}

SLOT_TYPE_MAP = {
    'standard': ['A', 'B', 'C'],
    'compact':  ['M'],
    'large':    ['T'],
}

def get_vehicle_type_from_class(class_label):
    return VEHICLE_CLASS_MAP.get(class_label.lower(), {'type': 'standard', 'size': 1})

def check_slot_type_match(vehicle_type, slot_id):
    # Slot types based on prefix
    slot_prefix = slot_id[0] if slot_id else ''
    allowed_types = []
    for typ, prefixes in SLOT_TYPE_MAP.items():
        if slot_prefix in prefixes:
            allowed_types.append(typ)
    return vehicle_type in allowed_types

def compute_iou(box1, box2):
    """
    Compute Intersection over Union (IoU) between two bounding boxes.
    
    Args:
        box1: [x1, y1, x2, y2]
        box2: [x1, y1, x2, y2]
        
    Returns:
        IoU value (float)
    """
    x1_1, y1_1, x2_1, y2_1 = box1
    x1_2, y1_2, x2_2, y2_2 = box2
    
    # Intersection
    x1_i = max(x1_1, x1_2)
    y1_i = max(y1_1, y1_2)
    x2_i = min(x2_1, x2_2)
    y2_i = min(y2_1, y2_2)
    
    if x2_i < x1_i or y2_i < y1_i:
        return 0.0
    
    intersection = (x2_i - x1_i) * (y2_i - y1_i)
    
    # Union
    area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
    area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0

def determine_occupancy(vehicle_detections, parking_slots, iou_threshold=0.3):
    """
    Determine occupancy status for each parking slot based on vehicle detections.
    
    Args:
        vehicle_detections: List of vehicle bboxes [{'bbox': [x1,y1,x2,y2], ...}]
        parking_slots: Dict {slot_id: [x1,y1,x2,y2]}
        iou_threshold: IoU threshold for occupancy
        
    Returns:
        Dict {slot_id: 'occupied' or 'available'}
    """
    occupancy = {}
    for slot_id, slot_bbox in parking_slots.items():
        occupied = False
        for detection in vehicle_detections:
            iou = compute_iou(slot_bbox, detection['bbox'])
            if iou > iou_threshold:
                occupied = True
                break
        occupancy[slot_id] = 'occupied' if occupied else 'available'
    return occupancy


def _point_in_polygon(point, polygon):
    """
    Ray casting algorithm. polygon is list of [x,y] floats.
    """
    if not polygon or len(polygon) < 3:
        return False
    x, y = point
    inside = False
    n = len(polygon)
    x1, y1 = polygon[0]
    for i in range(1, n + 1):
        x2, y2 = polygon[i % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1):
            inside = not inside
        x1, y1 = x2, y2
    return inside


def determine_occupancy_by_centroid(vehicle_detections, slot_polygons):
    """
    Determine occupancy based on whether the detection centroid lies inside
    the slot polygon.

    Args:
        vehicle_detections: List [{'bbox': [x1,y1,x2,y2], ...}]
        slot_polygons: Dict {slot_id: [[x,y], ...]}
    """
    occupancy = {}
    for slot_id, poly in (slot_polygons or {}).items():
        occupied = False
        for det in vehicle_detections:
            x1, y1, x2, y2 = det["bbox"]
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            if _point_in_polygon((cx, cy), poly):
                occupied = True
                break
        occupancy[slot_id] = "occupied" if occupied else "available"
    return occupancy

def get_parking_statistics(slot_statuses):
    """
    Calculate parking statistics.
    
    Args:
        slot_statuses: Dict {slot_id: 'occupied' or 'available'}
        
    Returns:
        Dict with total, occupied, available, occupancy_rate
    """
    total = len(slot_statuses)
    occupied = sum(1 for status in slot_statuses.values() if status == 'occupied')
    available = total - occupied
    occupancy_rate = (occupied / total) * 100 if total > 0 else 0
    
    return {
        'total': total,
        'occupied': occupied,
        'available': available,
        'occupancy_rate': round(occupancy_rate, 2)
    }
