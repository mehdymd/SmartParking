import easyocr
import re

reader = easyocr.Reader(['en'])   # adjust region in config

def read_plate(frame_crop, confidence_threshold=0.5):
    results = reader.readtext(frame_crop)
    candidates = [
        re.sub(r'[^A-Z0-9]', '', text.upper())
        for _, text, conf in results if conf >= confidence_threshold
    ]
    return candidates[0] if candidates else None
