import platform

import cv2


def _capture_backend_candidates(source):
    if not isinstance(source, int):
        return [(None, "default")]

    system = platform.system().lower()
    candidates = []

    def add(attr_name: str, label: str):
        backend = getattr(cv2, attr_name, None)
        if backend is None:
            return
        if any(existing == backend for existing, _ in candidates):
            return
        candidates.append((backend, label))

    if system == "darwin":
        add("CAP_AVFOUNDATION", "AVFoundation")
    elif system == "windows":
        add("CAP_DSHOW", "DirectShow")
        add("CAP_MSMF", "Media Foundation")
    else:
        add("CAP_V4L2", "V4L2")

    add("CAP_ANY", "Any")
    candidates.append((None, "default"))
    return candidates


def open_video_capture(source):
    attempted = []

    for backend, label in _capture_backend_candidates(source):
        attempted.append(label)
        cap = None
        try:
            if backend is None:
                cap = cv2.VideoCapture(source)
            else:
                cap = cv2.VideoCapture(source, backend)
        except TypeError:
            cap = cv2.VideoCapture(source)
        except Exception:
            cap = None

        if cap is None:
            continue

        if cap.isOpened():
            return cap, label, attempted

        try:
            cap.release()
        except Exception:
            pass

    return None, None, attempted
