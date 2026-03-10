from ultralytics import YOLO
import cv2
from .config import Config

class VehicleDetector:
    def __init__(self):
        self.model = YOLO(Config.YOLO_MODEL_PATH)
        # Vehicle classes: car, truck, bus, motorcycle
        self.vehicle_classes = [2, 5, 7, 3]  # COCO class IDs

    def detect_vehicles(self, frame):
        """
        Detect vehicles in the given frame using YOLOv8.
        
        Args:
            frame: OpenCV image frame
            
        Returns:
            List of detections: [{'bbox': [x1, y1, x2, y2], 'conf': confidence, 'class': class_name}]
        """
        results = self.model(frame, conf=0.5, classes=self.vehicle_classes)
        
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                conf = box.conf[0].cpu().numpy()
                cls = int(box.cls[0].cpu().numpy())
                class_name = self.model.names[cls]
                
                detections.append({
                    'bbox': [int(x1), int(y1), int(x2), int(y2)],
                    'conf': float(conf),
                    'class': class_name
                })
        
        return detections
