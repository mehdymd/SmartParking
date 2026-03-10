import torch
import torchvision.transforms as T
from torchvision.models.detection import fasterrcnn_resnet50_fpn
from PIL import Image
import numpy as np

class YOLO:
    """Original YOLO-like class using Faster R-CNN for object detection."""
    
    def __init__(self, model='fasterrcnn_resnet50_fpn'):
        self.model = fasterrcnn_resnet50_fpn(pretrained=True)
        self.model.eval()
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model.to(self.device)
        self.transform = T.Compose([T.ToTensor()])
        
    def predict(self, source, conf=0.5):
        """Run inference on image source."""
        if isinstance(source, str):
            image = Image.open(source).convert("RGB")
        elif isinstance(source, np.ndarray):
            image = Image.fromarray(source).convert("RGB")
        else:
            image = source
        
        img_tensor = self.transform(image).unsqueeze(0).to(self.device)
        
        with torch.no_grad():
            predictions = self.model(img_tensor)
        
        # Filter for vehicles (cars, trucks, buses - COCO classes 3,8,6)
        vehicle_classes = [3, 6, 8]  # car, bus, truck
        results = []
        for pred in predictions:
            boxes = pred['boxes'].cpu().numpy()
            labels = pred['labels'].cpu().numpy()
            scores = pred['scores'].cpu().numpy()
            
            for box, label, score in zip(boxes, labels, scores):
                if score > conf and label in vehicle_classes:
                    results.append({
                        'bbox': box.tolist(),
                        'conf': float(score),
                        'class': self.get_class_name(label)
                    })
        
        return results
    
    def get_class_name(self, label):
        """Get class name from COCO label."""
        coco_classes = {
            1: 'person', 2: 'bicycle', 3: 'car', 4: 'motorcycle', 5: 'airplane',
            6: 'bus', 7: 'train', 8: 'truck', 9: 'boat', 10: 'traffic light'
        }
        return coco_classes.get(label, 'unknown')
