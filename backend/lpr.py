import re
import os
import ssl
import cv2

try:
    import certifi
except Exception:
    certifi = None

try:
    import easyocr
except Exception:
    easyocr = None

_reader = None
LPR_AVAILABLE = easyocr is not None


def _ensure_ssl_certificates():
    if certifi is None:
        return
    cafile = certifi.where()
    if cafile:
        os.environ.setdefault("SSL_CERT_FILE", cafile)
        os.environ.setdefault("REQUESTS_CA_BUNDLE", cafile)
        ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=cafile)


def _get_reader():
    global _reader, LPR_AVAILABLE
    if _reader is not None:
        return _reader
    if easyocr is None:
        LPR_AVAILABLE = False
        return None
    try:
        _ensure_ssl_certificates()
        # OCR is CPU-bound here; forcing CPU avoids GPU-related startup failures.
        _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        LPR_AVAILABLE = True
    except Exception:
        _reader = None
        LPR_AVAILABLE = False
    return _reader


def _normalize_candidate(text):
    cleaned = re.sub(r"[^A-Z0-9]", "", (text or "").upper())
    return cleaned


def _candidate_score(text, confidence):
    score = float(confidence or 0.0)
    if 5 <= len(text) <= 10:
        score += 0.2
    if any(ch.isdigit() for ch in text):
        score += 0.15
    if any(ch.isalpha() for ch in text):
        score += 0.1
    return score


def _preprocess_plate_crop(frame_crop):
    if frame_crop is None or getattr(frame_crop, "size", 0) == 0:
        return []

    if len(frame_crop.shape) == 2:
        gray = frame_crop
        color = cv2.cvtColor(frame_crop, cv2.COLOR_GRAY2BGR)
    else:
        color = frame_crop
        gray = cv2.cvtColor(frame_crop, cv2.COLOR_BGR2GRAY)

    h, w = gray.shape[:2]
    scale = max(1, int(round(160 / max(1, min(h, w)))))
    if scale > 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        color = cv2.resize(color, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    gray = cv2.bilateralFilter(gray, 11, 17, 17)
    gray = cv2.equalizeHist(gray)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    inverted = cv2.bitwise_not(thresh)

    return [color, gray, thresh, inverted]


def read_plate_with_confidence(frame_crop, confidence_threshold=0.2):
    """
    Read a license plate from a cropped vehicle region.
    Returns a tuple: (plate string or None, confidence float or None).
    """
    reader = _get_reader()
    if reader is None:
        return None, None

    best_text = None
    best_conf = None
    best_score = float("-inf")

    try:
        for variant in _preprocess_plate_crop(frame_crop):
            results = reader.readtext(
                variant,
                allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                paragraph=False,
                detail=1,
            )
            for _, text, conf in results:
                normalized = _normalize_candidate(text)
                if len(normalized) < 4:
                    continue
                if not any(ch.isdigit() for ch in normalized):
                    continue
                if float(conf or 0.0) < confidence_threshold:
                    continue

                score = _candidate_score(normalized, conf)
                if score > best_score:
                    best_score = score
                    best_text = normalized
                    best_conf = float(conf)
    except Exception:
        return None, None

    return best_text, best_conf


def read_plate(frame_crop, confidence_threshold=0.5):
    """
    Read license plate text from a cropped frame region.
    Returns the plate string or None if nothing detected / LPR unavailable.
    """
    plate, _ = read_plate_with_confidence(frame_crop, confidence_threshold=confidence_threshold)
    return plate
