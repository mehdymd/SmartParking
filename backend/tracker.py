from collections import OrderedDict, deque
import numpy as np

class CentroidTracker:
    def __init__(self, max_disappeared=30):
        self.next_id = 0
        self.objects = OrderedDict()   # id → centroid
        self.disappeared = OrderedDict()
        self.history = {}              # id → deque of last 10 centroids

    def update(self, bboxes):
        # bboxes: list of (x1, y1, x2, y2)
        centroids = []
        for bbox in bboxes:
            cX = int((bbox[0] + bbox[2]) / 2.0)
            cY = int((bbox[1] + bbox[3]) / 2.0)
            centroids.append((cX, cY))

        if len(centroids) == 0:
            for object_id in list(self.disappeared.keys()):
                self.disappeared[object_id] += 1
                if self.disappeared[object_id] > self.max_disappeared:
                    self.deregister(object_id)
            return self.objects

        input_centroids = np.array(centroids)
        if len(self.objects) == 0:
            for i in range(0, len(input_centroids)):
                self.register(input_centroids[i])
        else:
            object_ids = list(self.objects.keys())
            object_centroids = list(self.objects.values())
            D = np.linalg.norm(np.array(object_centroids)[:, np.newaxis] - input_centroids, axis=2)
            rows = D.min(axis=1).argsort()
            cols = D.argmin(axis=1)[rows]
            used_rows = set()
            used_cols = set()
            for (row, col) in zip(rows, cols):
                if row in used_rows or col in used_cols:
                    continue
                object_id = object_ids[row]
                self.objects[object_id] = input_centroids[col]
                self.disappeared[object_id] = 0
                if object_id not in self.history:
                    self.history[object_id] = deque(maxlen=10)
                self.history[object_id].append(input_centroids[col])
                used_rows.add(row)
                used_cols.add(col)
            unused_rows = set(range(0, D.shape[0])).difference(used_rows)
            unused_cols = set(range(0, D.shape[1])).difference(used_cols)
            for row in unused_rows:
                object_id = object_ids[row]
                self.disappeared[object_id] += 1
                if self.disappeared[object_id] > self.max_disappeared:
                    self.deregister(object_id)
            for col in unused_cols:
                self.register(input_centroids[col])
        return self.objects

    def register(self, centroid):
        self.objects[self.next_id] = centroid
        self.disappeared[self.next_id] = 0
        self.history[self.next_id] = deque(maxlen=10)
        self.history[self.next_id].append(centroid)
        self.next_id += 1

    def deregister(self, object_id):
        del self.objects[object_id]
        del self.disappeared[object_id]
        del self.history[object_id]
