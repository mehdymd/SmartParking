from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Header, Request
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timedelta
from collections import defaultdict, deque
import json
import os
import re
import shutil
import uuid
import base64
import io
import hashlib
from urllib.parse import parse_qs, urlparse
from PIL import Image
import numpy as np
import cv2
from reportlab.graphics import renderSVG
from reportlab.graphics.barcode import createBarcodeDrawing
import sys
sys.path.append('../ultralytics_lib')

try:
    from .database import (
        get_db,
        get_all_slots,
        ParkingSlot,
        ParkingHistory,
        PlateLog,
        Transaction,
        ExportHistory,
        OccupancyHistory,
        ParkingSession,
        Alert,
        User,
        Reservation,
        PaymentCustomer,
        PaymentRecord,
        MonthlyPass,
        ParkingLot,
        WaitlistEntry,
        IncidentReport,
        ApiToken,
        Issue,
        CashPayment,
        PhoneOTP,
        update_slot_status,
    )
    from .video_source import open_video_capture
    from .parking_logic import get_parking_statistics
    from .config import Config
    from .heatmap import get_heatmap
    from .security import (
        hash_password,
        verify_password,
        create_access_token,
        decode_access_token,
        create_reservation_qr_token,
        decode_reservation_qr_token,
        generate_confirmation_code,
        generate_otp,
        hash_otp,
        verify_otp,
    )
except ImportError:
    from database import (
        get_db,
        get_all_slots,
        ParkingSlot,
        ParkingHistory,
        PlateLog,
        Transaction,
        ExportHistory,
        OccupancyHistory,
        ParkingSession,
        Alert,
        User,
        Reservation,
        PaymentCustomer,
        PaymentRecord,
        MonthlyPass,
        ParkingLot,
        WaitlistEntry,
        IncidentReport,
        ApiToken,
        Issue,
        CashPayment,
        PhoneOTP,
        update_slot_status,
    )
    from video_source import open_video_capture
    from parking_logic import get_parking_statistics
    from config import Config
    # NOTE: YOLO model is loaded once in backend/main.py lifespan.
    from heatmap import get_heatmap
    from security import (
        hash_password,
        verify_password,
        create_access_token,
        decode_access_token,
        create_reservation_qr_token,
        decode_reservation_qr_token,
        generate_confirmation_code,
        generate_otp,
        hash_otp,
        verify_otp,
    )

try:
    import stripe
    STRIPE_AVAILABLE = True
except Exception:
    stripe = None
    STRIPE_AVAILABLE = False

API_TOKEN_ACTIVITY = defaultdict(deque)

# Load settings (always relative to backend directory)
_BACKEND_DIR = os.path.dirname(__file__)
_SETTINGS_PATH = os.path.join(_BACKEND_DIR, "settings.json")
try:
    with open(_SETTINGS_PATH, "r") as f:
        settings = json.load(f)
except Exception:
    settings = {}

VIDEO_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "..", "videos"))
os.makedirs(VIDEO_DIR, exist_ok=True)

yolo_model = None  # legacy; prefer app.state.model

app = FastAPI(title="Smart Parking Management System")
RESERVATION_DURATION_MINUTES = 15
ACTIVE_RESERVATION_STATUSES = ("confirmed", "checked_in")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_image_file(path_or_name: str) -> bool:
    return str(path_or_name).lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))


def _is_video_file(path_or_name: str) -> bool:
    return str(path_or_name).lower().endswith(('.mp4', '.avi', '.mov', '.mkv'))


def _source_mode(source):
    normalized = _normalize_source_value(source)
    if normalized is None or normalized == "":
        return "none"
    if isinstance(normalized, int) or (isinstance(normalized, str) and normalized.startswith("/dev/video")):
        return "camera"
    return "upload"


def _normalize_source_value(source):
    if source is None:
        return None
    if isinstance(source, str):
        normalized = source.strip()
        if not normalized:
            return None
        if normalized.isdigit():
            return int(normalized)
        return normalized
    return source


def _validate_source_file(path: str):
    if _is_image_file(path):
        image = cv2.imread(path)
        return image is not None

    cap, _, _ = open_video_capture(path)
    try:
        if cap is None or not cap.isOpened():
            return False
        ok, _ = cap.read()
        return bool(ok)
    finally:
        if cap is not None:
            cap.release()


def _format_duration_minutes(duration_mins, entry_time=None, exit_time=None):
    if duration_mins is None and entry_time is not None:
        end_time = exit_time or datetime.utcnow()
        try:
            duration_mins = max(0, int((end_time - entry_time).total_seconds() / 60))
        except Exception:
            duration_mins = None

    if duration_mins is None:
        return None

    total_minutes = max(0, int(duration_mins))
    hours, mins = divmod(total_minutes, 60)
    if hours and mins:
        return f"{hours}h {mins}m"
    if hours:
        return f"{hours}h"
    return f"{mins}m"


def _derive_duration_minutes(duration_mins, entry_time=None, exit_time=None):
    if duration_mins is not None:
        return max(0, int(duration_mins))
    if entry_time is None:
        return None
    try:
        end_time = exit_time or datetime.utcnow()
        return max(0, int((end_time - entry_time).total_seconds() / 60))
    except Exception:
        return None


def _parse_iso_datetime(value: str):
    if not value:
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def _serialize_user(user: User):
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": bool(user.is_active),
        "created_at": user.created_at.isoformat() + "Z" if user.created_at else None,
    }


def _reservation_user_type(reservation: Reservation):
    if reservation.notes:
        try:
            parsed = json.loads(reservation.notes)
            if isinstance(parsed, dict):
                return _effective_user_type(parsed.get("user_type"))
        except Exception:
            pass
    return "visitor"


def _reservation_amount_payload(reservation: Reservation):
    amount = _zone_reservation_amount(
        reservation.zone or "A",
        reservation.start_time,
        reservation.end_time,
        _reservation_user_type(reservation),
    )
    return {
        "amount": round(float(amount or 0), 2),
        "currency": "USD",
    }


def _reservation_qr_data(reservation: Reservation):
    token = create_reservation_qr_token(reservation.id, reservation.confirmation_code)
    return {
        "cashier_qr_token": token,
        "cashier_qr_data": f"SPARKRES:{token}",
    }


def _qr_svg_data_uri(data: str, size: int = 160):
    payload = (data or "").strip()
    if not payload:
        return ""

    bounded_size = min(max(int(size or 160), 64), 1024)
    drawing = createBarcodeDrawing("QR", value=payload, width=bounded_size, height=bounded_size)
    svg = renderSVG.drawToString(drawing)
    if isinstance(svg, str):
        svg = svg.encode("utf-8")
    encoded = base64.b64encode(svg).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def _serialize_reservation(reservation: Reservation):
    extra_notes = reservation.notes
    user_type = "visitor"
    notes_value = reservation.notes
    if reservation.notes:
        try:
            parsed = json.loads(reservation.notes)
            if isinstance(parsed, dict):
                notes_value = parsed.get("notes")
                user_type = _effective_user_type(parsed.get("user_type"))
                extra_notes = parsed
        except Exception:
            pass
    amount_payload = _reservation_amount_payload(reservation)
    qr_payload = _reservation_qr_data(reservation)
    
    # Calculate time spent if entry_time exists
    time_spent_minutes = None
    if reservation.entry_time:
        from datetime import datetime
        end = reservation.actual_exit_time or datetime.utcnow()
        time_spent_minutes = int((end - reservation.entry_time).total_seconds() / 60)
    
    # Calculate overstay amount (double the hourly rate per minute overstayed)
    overstay_amount = 0
    if reservation.overstay_minutes and reservation.overstay_minutes > 0:
        from config import Config
        settings_data = {}
        try:
            with open(os.path.join(os.path.dirname(__file__), "settings.json"), "r") as f:
                settings_data = json.load(f) or {}
        except Exception:
            pass
        zone_pricing = settings_data.get("zone_pricing") or {"A": 2, "B": 1, "C": 4}
        hourly_rate = zone_pricing.get(reservation.zone or "A", 2)
        overstay_amount = round(hourly_rate * 2 * (reservation.overstay_minutes / 60), 2)
    
    return {
        "id": reservation.id,
        "confirmation_code": reservation.confirmation_code,
        "lot_name": reservation.lot_name,
        "slot_id": reservation.slot_id,
        "zone": reservation.zone,
        "full_name": reservation.full_name,
        "email": reservation.email,
        "phone": reservation.phone,
        "license_plate": reservation.license_plate,
        "start_time": reservation.start_time.isoformat() + "Z" if reservation.start_time else None,
        "end_time": reservation.end_time.isoformat() + "Z" if reservation.end_time else None,
        "entry_time": reservation.entry_time.isoformat() + "Z" if reservation.entry_time else None,
        "actual_exit_time": reservation.actual_exit_time.isoformat() + "Z" if reservation.actual_exit_time else None,
        "overstay_minutes": reservation.overstay_minutes or 0,
        "overstay_amount": overstay_amount,
        "time_spent_minutes": time_spent_minutes,
        "status": reservation.status,
        "payment_status": reservation.payment_status,
        "payment_method": reservation.payment_method,
        "payment_provider": reservation.payment_provider,
        "notes": notes_value,
        "user_type": user_type,
        "created_by_user_id": reservation.created_by_user_id,
        "created_at": reservation.created_at.isoformat() + "Z" if reservation.created_at else None,
        "metadata": extra_notes if isinstance(extra_notes, dict) else None,
        "estimated_amount": amount_payload["amount"],
        "currency": amount_payload["currency"],
        "qr_data": qr_payload["cashier_qr_data"],
        "qr_image": _qr_svg_data_uri(qr_payload["cashier_qr_data"], 180),
        "cashier_qr_data": qr_payload["cashier_qr_data"],
        "cashier_qr_token": qr_payload["cashier_qr_token"],
        "cashier_qr_image": _qr_svg_data_uri(qr_payload["cashier_qr_data"], 180),
        "legacy_qr_data": f"PARKING:{reservation.confirmation_code}|{reservation.license_plate or ''}|{reservation.zone or ''}|{reservation.slot_id or ''}",
    }


def _extract_bearer_token(authorization: str = ""):
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _get_current_user(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
):
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.username == subject).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not available")
    return user


def _require_roles(*roles):
    def dependency(user: User = Depends(_get_current_user)):
        if roles and user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return dependency


def _configured_slot_records():
    try:
        slots_path = _get_slots_path_for_current_source()
        with open(slots_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return []

    records = []
    for idx, area in enumerate(data.get("parking_areas") or []):
        slot_id = f"S{idx + 1}"
        if isinstance(area, dict):
            zone = area.get("zone", "A") or "A"
        else:
            zone = "A"
        records.append({"slot_id": slot_id, "zone": zone})
    return records


def _live_occupied_slot_ids(db: Session):
    rows = db.query(ParkingSlot.id).filter(ParkingSlot.status == "occupied").all()
    return {row[0] for row in rows if row and row[0]}


def _normalize_reservation_start(start_time: datetime = None):
    now = datetime.utcnow().replace(second=0, microsecond=0)
    if start_time is None:
        return now
    normalized = start_time.replace(second=0, microsecond=0)
    return normalized if normalized >= now else now


def _reservation_window(start_time: datetime = None):
    start_dt = _normalize_reservation_start(start_time)
    return start_dt, start_dt + timedelta(minutes=RESERVATION_DURATION_MINUTES)


def _expire_stale_reservations(db: Session):
    now = datetime.utcnow()
    expired = (
        db.query(Reservation)
        .filter(
            Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
            Reservation.end_time <= now,
        )
        .all()
    )
    if not expired:
        return []

    for reservation in expired:
        reservation.status = "expired"
    db.commit()

    promoted = []
    for reservation in expired:
        promoted_reservation = _promote_waitlist_if_possible(
            db,
            reservation.lot_name or "Main Lot",
            reservation.zone or "A",
            reservation.start_time,
            reservation.end_time,
        )
        if promoted_reservation:
            promoted.append(promoted_reservation.id)
    return promoted


def _active_reservations_for_window(db: Session, start_time: datetime, end_time: datetime):
    _expire_stale_reservations(db)
    return (
        db.query(Reservation)
        .filter(
            Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
            Reservation.start_time < end_time,
            Reservation.end_time > start_time,
            Reservation.slot_id.isnot(None),
        )
        .all()
    )


def _active_reserved_slot_ids(db: Session, at_time: datetime = None):
    current_time = at_time or datetime.utcnow()
    _expire_stale_reservations(db)
    rows = (
        db.query(Reservation.slot_id)
        .filter(
            Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
            Reservation.start_time <= current_time,
            Reservation.end_time > current_time,
            Reservation.slot_id.isnot(None),
        )
        .all()
    )
    return {row[0] for row in rows if row and row[0]}


def _normalize_license_plate(value: str):
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def _reservation_lookup_rank(reservation: Reservation):
    now = datetime.utcnow()
    status = reservation.status or ""
    start_time = reservation.start_time or reservation.created_at or now
    end_time = reservation.end_time or start_time
    if status in ACTIVE_RESERVATION_STATUSES and end_time > now:
        status_rank = 0
    elif status not in {"cancelled", "expired"} and end_time > now:
        status_rank = 1
    elif status not in {"cancelled"}:
        status_rank = 2
    elif status == "expired":
        status_rank = 3
    else:
        status_rank = 4

    if start_time <= now < end_time:
        window_rank = 0
    elif start_time > now:
        window_rank = 1
    else:
        window_rank = 2

    reference_time = start_time
    return (
        status_rank,
        window_rank,
        -(reference_time.timestamp() if isinstance(reference_time, datetime) else 0),
        -(reservation.id or 0),
    )


def _resolve_public_reservation(
    db: Session,
    confirmation_code: str = None,
    license_plate: str = None,
):
    _expire_stale_reservations(db)

    code = (confirmation_code or "").strip().upper()
    if code:
        return db.query(Reservation).filter(Reservation.confirmation_code == code).first()

    normalized_plate = _normalize_license_plate(license_plate)
    if not normalized_plate:
        return None

    normalized_column = func.upper(
        func.replace(
            func.replace(
                func.replace(
                    func.replace(Reservation.license_plate, " ", ""),
                    "-",
                    "",
                ),
                "_",
                "",
            ),
            ".",
            "",
        )
    )
    candidates = (
        db.query(Reservation)
        .filter(
            Reservation.license_plate.isnot(None),
            normalized_column == normalized_plate,
        )
        .order_by(Reservation.start_time.desc(), Reservation.created_at.desc(), Reservation.id.desc())
        .limit(25)
        .all()
    )
    if not candidates:
        return None
    return sorted(candidates, key=_reservation_lookup_rank)[0]


def _extract_reservation_scan_token(value: str = ""):
    raw = (value or "").strip()
    if not raw:
        return None

    if raw.upper().startswith("SPARKRES:"):
        return raw.split(":", 1)[1].strip()

    if raw.upper().startswith("PARKING:"):
        legacy_parts = raw.split(":", 1)[1].split("|")
        if legacy_parts:
            return f"LEGACY_CODE:{legacy_parts[0].strip().upper()}"

    if raw.startswith("http://") or raw.startswith("https://"):
        try:
            parsed = urlparse(raw)
            query = parse_qs(parsed.query)
            token = (query.get("reservation_token") or [None])[0]
            if token:
                return token.strip()
        except Exception:
            return None

    if raw.startswith("reservation_qr."):
        return raw
    return None


def _resolve_cashier_reservation(
    db: Session,
    query: str = None,
    license_plate: str = None,
):
    token = _extract_reservation_scan_token(query)
    if token:
        if token.startswith("LEGACY_CODE:"):
            return _resolve_public_reservation(
                db,
                confirmation_code=token.split(":", 1)[1],
                license_plate=license_plate,
            )
        payload = decode_reservation_qr_token(token)
        if not payload:
            raise HTTPException(status_code=400, detail="Invalid reservation QR")

        reservation_id = int(payload.get("reservation_id") or 0)
        confirmation_code = str(payload.get("confirmation_code") or "").strip().upper()
        reservation = (
            db.query(Reservation)
            .filter(
                Reservation.id == reservation_id,
                Reservation.confirmation_code == confirmation_code,
            )
            .first()
        )
        if not reservation:
            raise HTTPException(status_code=404, detail="Reservation not found")
        _expire_stale_reservations(db)
        db.refresh(reservation)
        return reservation

    return _resolve_public_reservation(
        db,
        confirmation_code=query,
        license_plate=license_plate,
    )


def _latest_reservation_payment(db: Session, reservation_id: int):
    return (
        db.query(PaymentRecord)
        .filter(
            PaymentRecord.reservation_id == reservation_id,
            PaymentRecord.payment_type == "reservation",
        )
        .order_by(PaymentRecord.created_at.desc(), PaymentRecord.id.desc())
        .first()
    )


def _cancel_reservation_record(db: Session, reservation: Reservation):
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.status == "cancelled":
        return {
            "reservation": _serialize_reservation(reservation),
            "promoted_reservation": None,
        }

    reservation.status = "cancelled"
    db.commit()
    db.refresh(reservation)
    promoted = _promote_waitlist_if_possible(
        db,
        reservation.lot_name or "Main Lot",
        reservation.zone or "A",
        reservation.start_time,
        reservation.end_time,
    )
    return {
        "reservation": _serialize_reservation(reservation),
        "promoted_reservation": _serialize_reservation(promoted) if promoted else None,
    }


def _slot_state_snapshot(db: Session, start_time: datetime, end_time: datetime, zone: str = None):
    configured_slots = _configured_slot_records()
    if zone:
        configured_slots = [slot for slot in configured_slots if slot["zone"] == zone]

    occupied_slot_ids = _live_occupied_slot_ids(db)
    conflicting_reservations = _active_reservations_for_window(db, start_time, end_time)
    reserved_slot_ids = {reservation.slot_id for reservation in conflicting_reservations if reservation.slot_id}

    slot_states = []
    available_slots = []
    for slot in configured_slots:
        slot_id = slot["slot_id"]
        if slot_id in occupied_slot_ids:
            state = "occupied"
        elif slot_id in reserved_slot_ids:
            state = "reserved"
        else:
            state = "available"
            available_slots.append(slot)
        slot_states.append({**slot, "state": state})

    return {
        "slot_states": slot_states,
        "available_slots": available_slots,
        "occupied_slot_ids": sorted(occupied_slot_ids),
        "reserved_slot_ids": sorted(reserved_slot_ids),
    }


def _find_available_slot(db: Session, start_time: datetime, end_time: datetime, zone: str = None):
    snapshot = _slot_state_snapshot(db, start_time, end_time, zone=zone)
    available = snapshot["available_slots"]
    return available[0] if available else None


def _reservation_query(db: Session, status: str = None, search: str = None):
    _expire_stale_reservations(db)
    query = db.query(Reservation)
    if status:
        query = query.filter(Reservation.status == status)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            (Reservation.confirmation_code.ilike(term))
            | (Reservation.full_name.ilike(term))
            | (Reservation.license_plate.ilike(term))
            | (Reservation.slot_id.ilike(term))
        )
    return query


def _load_runtime_settings():
    try:
        with open(_SETTINGS_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


def _save_runtime_settings(settings_data: dict):
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as handle:
        json.dump(settings_data, handle, indent=2)
    return settings_data


def _camera_slug(value: str):
    base = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return base or f"camera-{uuid.uuid4().hex[:8]}"


def _camera_slots_path(camera_id: str):
    safe_id = _camera_slug(camera_id)
    return os.path.join(Config.SLOTS_DIR, f"parking_slots_{safe_id}.json")


def _load_camera_sources():
    settings_data = _load_runtime_settings()
    raw_sources = settings_data.get("camera_sources") or []
    cameras = []
    used_ids = set()

    for index, item in enumerate(raw_sources):
        if not isinstance(item, dict):
            continue
        source = _normalize_source_value(item.get("source"))
        if source is None or source == "":
            continue

        suggested_id = item.get("id") or item.get("name") or f"camera-{index + 1}"
        camera_id = _camera_slug(suggested_id)
        while camera_id in used_ids:
            camera_id = f"{camera_id}-{len(used_ids) + 1}"
        used_ids.add(camera_id)

        name = str(item.get("name") or f"Camera {len(cameras) + 1}").strip() or f"Camera {len(cameras) + 1}"
        slot_path = str(item.get("slots_path") or _camera_slots_path(camera_id)).strip()
        cameras.append({
            "id": camera_id,
            "name": name,
            "source": source,
            "mode": _source_mode(source),
            "slots_path": slot_path,
        })

    return cameras


def _get_camera_by_id(camera_id: str):
    if not camera_id:
        return None
    for camera in _load_camera_sources():
        if camera["id"] == camera_id:
            return camera
    return None


def _get_active_camera_id():
    active_camera_id = getattr(app.state, "active_camera_id", None)
    if active_camera_id:
        return active_camera_id

    current_source = _normalize_source_value(getattr(app.state, "camera_source", getattr(Config, "VIDEO_SOURCE", None)))
    for camera in _load_camera_sources():
        if _normalize_source_value(camera["source"]) == current_source:
            return camera["id"]
    return None


def _serialize_camera(camera: dict, active_camera_id: str = None, current_source=None):
    normalized_source = _normalize_source_value(camera.get("source"))
    return {
        "id": camera["id"],
        "name": camera["name"],
        "source": normalized_source,
        "mode": camera.get("mode") or _source_mode(normalized_source),
        "slots_path": camera.get("slots_path"),
        "is_active": camera["id"] == active_camera_id or _normalize_source_value(current_source) == normalized_source,
    }


def _stripe_secret_key():
    settings_data = _load_runtime_settings()
    return (
        os.getenv("STRIPE_SECRET_KEY")
        or settings_data.get("stripe_secret_key")
        or ""
    ).strip()


def _stripe_publishable_key():
    settings_data = _load_runtime_settings()
    return (
        os.getenv("STRIPE_PUBLISHABLE_KEY")
        or settings_data.get("stripe_publishable_key")
        or ""
    ).strip()


def _stripe_webhook_secret():
    settings_data = _load_runtime_settings()
    return (
        os.getenv("STRIPE_WEBHOOK_SECRET")
        or settings_data.get("stripe_webhook_secret")
        or ""
    ).strip()


def _payment_enabled():
    settings_data = _load_runtime_settings()
    return bool(settings_data.get("stripe_enabled", True))


def _admin_qr_payment_config():
    settings_data = _load_runtime_settings()
    qr_code = str(
        settings_data.get("admin_payment_qr_url")
        or settings_data.get("admin_payment_qr_code")
        or ""
    ).strip()
    receiver_name = str(settings_data.get("admin_payment_receiver_name") or "Admin Test Account").strip()
    instructions = str(
        settings_data.get("admin_payment_notes")
        or "Scan the admin Alipay QR, complete the transfer, then confirm the payment in the dashboard."
    ).strip()
    enabled = bool(qr_code)
    return {
        "enabled": enabled,
        "provider": "admin_qr",
        "method": "alipay_qr",
        "receiver_name": receiver_name,
        "qr_code": qr_code,
        "instructions": instructions,
    }


def _access_portal_config():
    settings_data = _load_runtime_settings()
    return {
        "title": str(settings_data.get("access_portal_title") or "SmartParking Access").strip(),
        "tagline": str(
            settings_data.get("access_portal_tagline")
            or "Reserve, monitor, pay, and follow live parking activity from one smart entry point."
        ).strip(),
        "public_url": str(settings_data.get("access_portal_url") or "").strip(),
        "zone_pricing": settings_data.get("zone_pricing", {"A": 2, "B": 1, "C": 4}),
        "zone_duration": settings_data.get("zone_duration", {"A": 1, "B": 1, "C": 1}),
    }


def _monthly_pass_catalog():
    settings_data = _load_runtime_settings()
    raw_catalog = settings_data.get("monthly_pass_catalog")
    if isinstance(raw_catalog, list) and raw_catalog:
        catalog = []
        for idx, item in enumerate(raw_catalog):
            if not isinstance(item, dict):
                continue
            zone = str(item.get("zone") or "A").upper()
            amount = float(item.get("amount") or 0)
            if amount <= 0:
                continue
            catalog.append({
                "id": str(item.get("id") or f"monthly-{zone.lower()}-{idx + 1}"),
                "name": str(item.get("name") or f"Zone {zone} Monthly Pass"),
                "zone": zone,
                "amount": round(amount, 2),
                "currency": str(item.get("currency") or "usd").lower(),
                "interval": str(item.get("interval") or "month"),
                "description": str(item.get("description") or "Recurring monthly parking access"),
            })
        if catalog:
            return catalog

    return [
        {"id": "monthly-zone-a", "name": "Zone A Monthly Pass", "zone": "A", "amount": 120.0, "currency": "cny", "interval": "month", "description": "Standard monthly access"},
        {"id": "monthly-zone-b", "name": "Zone B Monthly Pass", "zone": "B", "amount": 90.0, "currency": "cny", "interval": "month", "description": "Economy monthly access"},
        {"id": "monthly-zone-c", "name": "Zone C Monthly Pass", "zone": "C", "amount": 180.0, "currency": "cny", "interval": "month", "description": "Premium monthly access"},
    ]


def _zone_reservation_amount(zone: str, start_time: datetime, end_time: datetime, user_type: str = "visitor"):
    settings_data = _load_runtime_settings()
    zone = (zone or "A").upper()
    zone_pricing = settings_data.get("zone_pricing") or {"A": 2, "B": 1, "C": 4}
    zone_duration = settings_data.get("zone_duration") or {"A": 1, "B": 1, "C": 1}
    pricing_unit = settings_data.get("pricing_unit", "hour")

    price = float(zone_pricing.get(zone, zone_pricing.get("A", 2)) or 0)
    duration_value = float(zone_duration.get(zone, zone_duration.get("A", 1)) or 1)
    total_minutes = max(1, int((end_time - start_time).total_seconds() / 60))
    block_minutes = duration_value if pricing_unit == "minute" else duration_value * 60
    block_minutes = max(1, int(round(block_minutes)))
    blocks = max(1, int(np.ceil(total_minutes / block_minutes)))
    return round(price * blocks * _user_type_multiplier(user_type), 2)


def _require_stripe():
    if not STRIPE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Stripe SDK is not installed")
    if not _payment_enabled():
        raise HTTPException(status_code=503, detail="Stripe payments are disabled")
    secret_key = _stripe_secret_key()
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    stripe.api_key = secret_key
    return stripe


def _frontend_base_from_request(request: Request):
    configured = (os.getenv("FRONTEND_BASE_URL") or "").strip()
    if configured:
        return configured.rstrip("/")

    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")

    host = request.headers.get("host") or "localhost:3000"
    scheme = "https" if request.url.scheme == "https" else "http"
    if host.endswith(":8000"):
        host = host[:-5] + ":3000"
    return f"{scheme}://{host}".rstrip("/")


def _get_or_create_stripe_customer(db: Session, user: User, email: str = None, full_name: str = None):
    billing = None
    if user:
        billing = db.query(PaymentCustomer).filter(PaymentCustomer.user_id == user.id).first()
    if billing and billing.stripe_customer_id:
        return billing

    stripe_client = _require_stripe()
    customer_email = (email or getattr(user, "username", None) or "").strip() or None
    customer_name = (full_name or getattr(user, "full_name", None) or getattr(user, "username", None) or "").strip() or None
    customer = stripe_client.Customer.create(
        email=customer_email,
        name=customer_name,
        metadata={"user_id": str(user.id) if user and user.id else ""},
    )

    if billing is None:
        billing = PaymentCustomer(
            user_id=user.id if user else None,
            email=customer_email,
            full_name=customer_name,
            stripe_customer_id=customer.id,
        )
        db.add(billing)
    else:
        billing.email = customer_email
        billing.full_name = customer_name
        billing.stripe_customer_id = customer.id
    db.commit()
    db.refresh(billing)
    return billing


def _payment_record_payload(record: PaymentRecord):
    metadata = {}
    if record.metadata_json:
        try:
            metadata = json.loads(record.metadata_json)
        except Exception:
            metadata = {}
    return {
        "id": record.id,
        "reservation_id": record.reservation_id,
        "monthly_pass_id": record.monthly_pass_id,
        "amount": float(record.amount or 0),
        "currency": record.currency,
        "payment_type": record.payment_type,
        "payment_method": record.payment_method,
        "payment_provider": record.payment_provider,
        "status": record.status,
        "stripe_checkout_session_id": record.stripe_checkout_session_id,
        "stripe_payment_intent_id": record.stripe_payment_intent_id,
        "stripe_invoice_id": record.stripe_invoice_id,
        "paid_at": record.paid_at.isoformat() + "Z" if record.paid_at else None,
        "metadata": metadata,
    }


def _cash_payment_payload(payment: CashPayment, reservation: Reservation = None, cashier: User = None):
    linked_reservation = reservation
    linked_cashier = cashier
    return {
        "id": payment.id,
        "reservation_id": payment.reservation_id,
        "confirmation_code": linked_reservation.confirmation_code if linked_reservation else None,
        "full_name": linked_reservation.full_name if linked_reservation else None,
        "phone": linked_reservation.phone if linked_reservation else None,
        "license_plate": linked_reservation.license_plate if linked_reservation else None,
        "slot_id": linked_reservation.slot_id if linked_reservation else None,
        "zone": linked_reservation.zone if linked_reservation else None,
        "reservation_status": linked_reservation.status if linked_reservation else None,
        "payment_status": linked_reservation.payment_status if linked_reservation else None,
        "reservation_end_time": linked_reservation.end_time.isoformat() + "Z" if linked_reservation and linked_reservation.end_time else None,
        "amount": float(payment.amount or 0),
        "currency": payment.currency,
        "received_by": payment.received_by,
        "received_by_name": linked_cashier.full_name if linked_cashier and linked_cashier.full_name else (linked_cashier.username if linked_cashier else None),
        "status": payment.status,
        "notes": payment.notes,
        "created_at": payment.created_at.isoformat() + "Z" if payment.created_at else None,
        "reservation": _serialize_reservation(linked_reservation) if linked_reservation else None,
    }


def _cashier_payment_record_payload(record: PaymentRecord, reservation: Reservation = None, cashier: User = None):
    metadata = {}
    if record.metadata_json:
        try:
            metadata = json.loads(record.metadata_json) or {}
        except Exception:
            metadata = {}

    linked_reservation = reservation
    linked_cashier = cashier
    payment_method = (record.payment_method or metadata.get("payment_method") or "cash").lower()
    return {
        "id": record.id,
        "reservation_id": record.reservation_id,
        "confirmation_code": linked_reservation.confirmation_code if linked_reservation else metadata.get("confirmation_code"),
        "full_name": linked_reservation.full_name if linked_reservation else metadata.get("full_name"),
        "phone": linked_reservation.phone if linked_reservation else metadata.get("phone"),
        "license_plate": linked_reservation.license_plate if linked_reservation else metadata.get("license_plate"),
        "slot_id": linked_reservation.slot_id if linked_reservation else metadata.get("slot_id"),
        "zone": linked_reservation.zone if linked_reservation else metadata.get("zone"),
        "reservation_status": linked_reservation.status if linked_reservation else metadata.get("reservation_status"),
        "payment_status": linked_reservation.payment_status if linked_reservation else record.status,
        "amount": float(record.amount or 0),
        "currency": record.currency,
        "payment_method": payment_method,
        "payment_provider": record.payment_provider,
        "received_by": linked_cashier.id if linked_cashier else record.user_id,
        "received_by_name": linked_cashier.full_name if linked_cashier and linked_cashier.full_name else (linked_cashier.username if linked_cashier else None),
        "status": record.status,
        "notes": metadata.get("notes"),
        "amount_received": metadata.get("amount_received"),
        "change_due": metadata.get("change_due"),
        "created_at": record.created_at.isoformat() + "Z" if record.created_at else None,
        "paid_at": record.paid_at.isoformat() + "Z" if record.paid_at else None,
        "reservation": _serialize_reservation(linked_reservation) if linked_reservation else None,
        "metadata": metadata,
    }


def _monthly_pass_payload(record: MonthlyPass):
    return {
        "id": record.id,
        "user_id": record.user_id,
        "full_name": record.full_name,
        "email": record.email,
        "phone": record.phone,
        "license_plate": record.license_plate,
        "lot_name": record.lot_name,
        "zone": record.zone,
        "plan_name": record.plan_name,
        "amount": float(record.amount or 0),
        "currency": record.currency,
        "interval": record.interval,
        "status": record.status,
        "stripe_customer_id": record.stripe_customer_id,
        "stripe_subscription_id": record.stripe_subscription_id,
        "current_period_start": record.current_period_start.isoformat() + "Z" if record.current_period_start else None,
        "current_period_end": record.current_period_end.isoformat() + "Z" if record.current_period_end else None,
        "cancel_at_period_end": bool(record.cancel_at_period_end),
        "created_at": record.created_at.isoformat() + "Z" if record.created_at else None,
    }


def _sync_subscription_state(db: Session, subscription_id: str, status: str = None):
    if not subscription_id:
        return None
    monthly_pass = db.query(MonthlyPass).filter(MonthlyPass.stripe_subscription_id == subscription_id).first()
    if not monthly_pass:
        return None

    stripe_client = _require_stripe()
    subscription = stripe_client.Subscription.retrieve(subscription_id)
    current_period_start = getattr(subscription, "current_period_start", None)
    current_period_end = getattr(subscription, "current_period_end", None)
    monthly_pass.status = status or getattr(subscription, "status", monthly_pass.status)
    monthly_pass.current_period_start = datetime.utcfromtimestamp(current_period_start) if current_period_start else None
    monthly_pass.current_period_end = datetime.utcfromtimestamp(current_period_end) if current_period_end else None
    monthly_pass.cancel_at_period_end = bool(getattr(subscription, "cancel_at_period_end", False))
    db.commit()
    db.refresh(monthly_pass)
    return monthly_pass


def _serialize_lot(lot: ParkingLot):
    return {
        "id": lot.id,
        "code": lot.code,
        "name": lot.name,
        "address": lot.address,
        "total_slots": lot.total_slots,
        "is_active": bool(lot.is_active),
        "created_at": lot.created_at.isoformat() + "Z" if lot.created_at else None,
    }


def _serialize_waitlist(entry: WaitlistEntry):
    return {
        "id": entry.id,
        "lot_name": entry.lot_name,
        "zone": entry.zone,
        "full_name": entry.full_name,
        "email": entry.email,
        "phone": entry.phone,
        "license_plate": entry.license_plate,
        "user_type": entry.user_type,
        "start_time": entry.start_time.isoformat() + "Z" if entry.start_time else None,
        "end_time": entry.end_time.isoformat() + "Z" if entry.end_time else None,
        "status": entry.status,
        "notes": entry.notes,
        "promoted_reservation_id": entry.promoted_reservation_id,
        "created_by_user_id": entry.created_by_user_id,
        "created_at": entry.created_at.isoformat() + "Z" if entry.created_at else None,
    }


def _serialize_incident(incident: IncidentReport):
    return {
        "id": incident.id,
        "lot_name": incident.lot_name,
        "slot_id": incident.slot_id,
        "severity": incident.severity,
        "category": incident.category,
        "title": incident.title,
        "description": incident.description,
        "image_path": incident.image_path,
        "reporter_name": incident.reporter_name,
        "reported_by_user_id": incident.reported_by_user_id,
        "status": incident.status,
        "created_at": incident.created_at.isoformat() + "Z" if incident.created_at else None,
    }


def _token_hash(token: str):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _generate_api_token_value():
    return f"spk_{uuid.uuid4().hex}{uuid.uuid4().hex[:8]}"


def _check_rate_limit(token_key: str, per_minute: int):
    queue = API_TOKEN_ACTIVITY[token_key]
    now_ts = datetime.utcnow().timestamp()
    while queue and (now_ts - queue[0]) >= 60:
        queue.popleft()
    if len(queue) >= max(1, int(per_minute or 60)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded for API token")
    queue.append(now_ts)


def _get_api_token_record(x_api_token: str = Header(default=""), db: Session = Depends(get_db)):
    token_value = (x_api_token or "").strip()
    if not token_value:
        raise HTTPException(status_code=401, detail="Missing X-API-Token header")
    record = db.query(ApiToken).filter(ApiToken.token_hash == _token_hash(token_value), ApiToken.is_active == True).first()
    if not record:
        raise HTTPException(status_code=401, detail="Invalid API token")
    _check_rate_limit(record.token_hash, record.rate_limit_per_minute)
    record.last_used_at = datetime.utcnow()
    db.commit()
    return record


def _effective_user_type(user_type: str):
    normalized = (user_type or "visitor").strip().lower()
    return normalized if normalized in {"employee", "visitor"} else "visitor"


def _user_type_multiplier(user_type: str):
    settings_data = _load_runtime_settings()
    multipliers = settings_data.get("user_type_pricing") or {"employee": 0.5, "visitor": 1.0}
    return float(multipliers.get(_effective_user_type(user_type), 1.0) or 1.0)


def _promote_waitlist_if_possible(db: Session, lot_name: str, zone: str, start_time: datetime, end_time: datetime):
    entry = (
        db.query(WaitlistEntry)
        .filter(
            WaitlistEntry.status == "waiting",
            WaitlistEntry.lot_name == lot_name,
            WaitlistEntry.start_time < end_time,
            WaitlistEntry.end_time > start_time,
        )
        .order_by(WaitlistEntry.created_at.asc(), WaitlistEntry.id.asc())
        .first()
    )
    if not entry:
        return None

    selected_slot = _find_available_slot(db, entry.start_time, entry.end_time, entry.zone or zone)
    if not selected_slot:
        return None

    confirmation_code = generate_confirmation_code()
    while db.query(Reservation).filter(Reservation.confirmation_code == confirmation_code).first():
        confirmation_code = generate_confirmation_code()

    reservation = Reservation(
        confirmation_code=confirmation_code,
        lot_name=entry.lot_name or lot_name or "Main Lot",
        slot_id=selected_slot["slot_id"],
        zone=selected_slot["zone"],
        full_name=entry.full_name,
        email=entry.email,
        phone=entry.phone,
        license_plate=(entry.license_plate or "").strip().upper() or None,
        start_time=entry.start_time,
        end_time=entry.end_time,
        status="confirmed",
        payment_status="pending",
        payment_method=None,
        payment_provider=None,
        notes=entry.notes,
        created_by_user_id=entry.created_by_user_id,
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)

    entry.status = "promoted"
    entry.promoted_reservation_id = reservation.id
    db.commit()
    return reservation


def _forecast_occupancy_points(db: Session, hours: int = 6):
    hours = max(1, min(int(hours or 6), 48))
    history = db.query(OccupancyHistory).order_by(OccupancyHistory.timestamp.desc()).limit(24 * 14).all()
    buckets = defaultdict(list)
    for item in history:
        if item.timestamp is None or item.occupancy_rate is None:
            continue
        buckets[item.timestamp.hour].append(float(item.occupancy_rate))

    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    points = []
    for offset in range(hours):
        ts = now + timedelta(hours=offset)
        samples = buckets.get(ts.hour) or []
        forecast = round(sum(samples) / len(samples), 2) if samples else 0.0
        points.append({
            "time": ts.isoformat() + "Z",
            "occupancy": forecast,
            "confidence": round(min(1.0, len(samples) / 12.0), 2),
        })
    return points


def _reservation_availability_payload(db: Session, start_dt: datetime, end_dt: datetime, zone: str = None):
    snapshot = _slot_state_snapshot(db, start_dt, end_dt, zone=zone)
    slots = snapshot["slot_states"]
    available_slots = snapshot["available_slots"]
    return {
        "total_slots": len(slots),
        "reserved_slots": len([slot for slot in slots if slot["state"] == "reserved"]),
        "occupied_slots": len([slot for slot in slots if slot["state"] == "occupied"]),
        "available_slots": available_slots,
        "slot_states": slots,
        "window_start": start_dt.isoformat() + "Z",
        "window_end": end_dt.isoformat() + "Z",
        "duration_minutes": RESERVATION_DURATION_MINUTES,
        "should_waitlist": len(available_slots) == 0,
    }


def _create_waitlist_entry(db: Session, data: dict, full_name: str, user_type: str, start_dt: datetime, end_dt: datetime, creator_user_id: int = None):
    waitlist = WaitlistEntry(
        lot_name=(data.get("lot_name") or "Main Lot").strip() or "Main Lot",
        zone=(data.get("zone") or "").strip().upper() or None,
        full_name=full_name,
        email=(data.get("email") or "").strip() or None,
        phone=(data.get("phone") or "").strip() or None,
        license_plate=(data.get("license_plate") or "").strip().upper() or None,
        user_type=user_type,
        start_time=start_dt,
        end_time=end_dt,
        status="waiting",
        notes=(data.get("notes") or "").strip() or None,
        created_by_user_id=creator_user_id,
    )
    db.add(waitlist)
    db.commit()
    db.refresh(waitlist)
    return waitlist


def _create_reservation_record(data: dict, db: Session, creator_user_id: int = None):
    try:
        requested_start = _parse_iso_datetime(data.get("start_time")) if data.get("start_time") else None
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reservation time")

    start_dt, end_dt = _reservation_window(requested_start)
    full_name = (data.get("full_name") or "").strip()
    user_type = _effective_user_type(data.get("user_type"))
    if not full_name:
        raise HTTPException(status_code=400, detail="Guest name is required")

    configured_slots = _configured_slot_records()
    if not configured_slots:
        raise HTTPException(status_code=400, detail="No parking slots configured yet")

    requested_slot_id = (data.get("slot_id") or "").strip() or None
    requested_zone = (data.get("zone") or "").strip().upper() or None
    fallback_action = (data.get("fallback_action") or "change_slot").strip().lower()
    allow_waitlist = bool(data.get("allow_waitlist", True))
    snapshot = _slot_state_snapshot(db, start_dt, end_dt, zone=requested_zone)
    selected_slot = None

    if requested_slot_id:
        selected_slot = next((slot for slot in configured_slots if slot["slot_id"] == requested_slot_id and (not requested_zone or slot["zone"] == requested_zone)), None)
        if not selected_slot:
            raise HTTPException(status_code=404, detail="Requested slot does not exist")
        requested_state = next((slot["state"] for slot in snapshot["slot_states"] if slot["slot_id"] == requested_slot_id), "available")
        if requested_state != "available":
            if fallback_action == "change_slot":
                selected_slot = next((slot for slot in snapshot["available_slots"] if slot["slot_id"] != requested_slot_id), None)
            else:
                selected_slot = None

            if selected_slot is None:
                if allow_waitlist:
                    waitlist = _create_waitlist_entry(db, data, full_name, user_type, start_dt, end_dt, creator_user_id=creator_user_id)
                    return {
                        "waitlist": waitlist,
                        "message": "Requested slot is unavailable. Added to waitlist.",
                        "alternatives": snapshot["available_slots"],
                    }
                raise HTTPException(status_code=409, detail="Requested slot is occupied or reserved")
    else:
        selected_slot = snapshot["available_slots"][0] if snapshot["available_slots"] else None
        if not selected_slot:
            if allow_waitlist:
                waitlist = _create_waitlist_entry(db, data, full_name, user_type, start_dt, end_dt, creator_user_id=creator_user_id)
                return {
                    "waitlist": waitlist,
                    "message": "No slots available. Added to waitlist.",
                    "alternatives": [],
                }
            raise HTTPException(status_code=409, detail="No available slots for the selected time range")

    conflict = (
        db.query(Reservation)
        .filter(
            Reservation.slot_id == selected_slot["slot_id"],
            Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
            Reservation.start_time < end_dt,
            Reservation.end_time > start_dt,
        )
        .first()
    )
    if conflict:
        raise HTTPException(status_code=409, detail="Selected slot is already reserved in that time window")

    confirmation_code = generate_confirmation_code()
    while db.query(Reservation).filter(Reservation.confirmation_code == confirmation_code).first():
        confirmation_code = generate_confirmation_code()

    reservation = Reservation(
        confirmation_code=confirmation_code,
        lot_name=(data.get("lot_name") or "Main Lot").strip() or "Main Lot",
        slot_id=selected_slot["slot_id"],
        zone=selected_slot["zone"],
        full_name=full_name,
        email=(data.get("email") or "").strip() or None,
        phone=(data.get("phone") or "").strip() or None,
        license_plate=(data.get("license_plate") or "").strip().upper() or None,
        start_time=start_dt,
        end_time=end_dt,
        status="confirmed",
        payment_status=(data.get("payment_status") or "pending").strip() or "pending",
        payment_method=(data.get("payment_method") or "").strip() or None,
        payment_provider=(data.get("payment_provider") or "").strip() or None,
        notes=json.dumps({
            "notes": (data.get("notes") or "").strip() or None,
            "user_type": user_type,
        }),
        created_by_user_id=creator_user_id,
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)
    return {
        "reservation": reservation,
        "reservation_window_minutes": RESERVATION_DURATION_MINUTES,
        "slot_changed": bool(requested_slot_id and selected_slot["slot_id"] != requested_slot_id),
        "alternatives": snapshot["available_slots"],
    }


def _prepare_reservation_payment(db: Session, reservation: Reservation, user_id: int = None):
    qr_config = _admin_qr_payment_config()
    if not qr_config["enabled"]:
        raise HTTPException(status_code=503, detail="Admin Alipay QR payments are not configured")
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if reservation.status in {"cancelled", "expired"}:
        raise HTTPException(status_code=400, detail="This reservation cannot be paid")
    if reservation.payment_status == "paid":
        raise HTTPException(status_code=400, detail="Reservation is already paid")

    reservation_user_type = "visitor"
    if reservation.notes:
        try:
            parsed_notes = json.loads(reservation.notes)
            if isinstance(parsed_notes, dict):
                reservation_user_type = _effective_user_type(parsed_notes.get("user_type"))
        except Exception:
            pass

    amount = _zone_reservation_amount(reservation.zone or "A", reservation.start_time, reservation.end_time, reservation_user_type)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Reservation amount is invalid")

    payment_record = (
        db.query(PaymentRecord)
        .filter(
            PaymentRecord.reservation_id == reservation.id,
            PaymentRecord.payment_type == "reservation",
            PaymentRecord.status == "pending",
        )
        .order_by(PaymentRecord.created_at.desc(), PaymentRecord.id.desc())
        .first()
    )

    metadata = {
        "confirmation_code": reservation.confirmation_code,
        "slot_id": reservation.slot_id,
        "zone": reservation.zone,
        "receiver_name": qr_config["receiver_name"],
        "instructions": qr_config["instructions"],
        "qr_code": qr_config["qr_code"],
        "payment_reference": reservation.confirmation_code,
    }

    if payment_record is None:
        payment_record = PaymentRecord(
            user_id=user_id,
            reservation_id=reservation.id,
            amount=amount,
            currency="usd",
            payment_type="reservation",
            payment_method=qr_config["method"],
            payment_provider=qr_config["provider"],
            status="pending",
            metadata_json=json.dumps(metadata),
        )
        db.add(payment_record)
    else:
        payment_record.user_id = payment_record.user_id or user_id
        payment_record.amount = amount
        payment_record.currency = "usd"
        payment_record.payment_method = qr_config["method"]
        payment_record.payment_provider = qr_config["provider"]
        payment_record.metadata_json = json.dumps(metadata)

    reservation.payment_status = "pending"
    reservation.payment_method = qr_config["method"]
    reservation.payment_provider = qr_config["provider"]
    db.commit()
    db.refresh(payment_record)
    db.refresh(reservation)
    return {
        "payment": _payment_record_payload(payment_record),
        "payment_request": {
            "reservation_id": reservation.id,
            "reservation_code": reservation.confirmation_code,
            "amount": amount,
            "currency": "USD",
            "receiver_name": qr_config["receiver_name"],
            "instructions": qr_config["instructions"],
            "qr_code": qr_config["qr_code"],
            "payment_method": qr_config["method"],
            "payment_provider": qr_config["provider"],
            "payment_id": payment_record.id,
            "status": payment_record.status,
        },
    }


@app.post("/auth/login")
def auth_login(data: dict, db: Session = Depends(get_db)):
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    user = db.query(User).filter(User.username == username).first()
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.username, user.role)
    return {"token": token, "user": _serialize_user(user)}


@app.get("/auth/me")
def auth_me(user: User = Depends(_get_current_user)):
    return {"user": _serialize_user(user)}


@app.get("/auth/users")
def auth_list_users(
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin")),
):
    users = db.query(User).order_by(User.created_at.asc(), User.id.asc()).all()
    return {"users": [_serialize_user(user) for user in users]}


@app.post("/auth/users")
def auth_create_user(
    data: dict,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin")),
):
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = (data.get("role") or "viewer").strip().lower()
    full_name = (data.get("full_name") or "").strip() or None

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    if role not in {"admin", "cashier", "operator", "user"}:
        raise HTTPException(status_code=400, detail="Role must be admin, cashier, operator, or user")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        username=username,
        full_name=full_name,
        role=role,
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"user": _serialize_user(user)}


@app.delete("/auth/users/{user_id}")
def auth_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin users")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


@app.post("/auth/change-password")
def auth_change_password(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    user.password_hash = hash_password(new_password)
    db.commit()
    return {"message": "Password updated"}


@app.get("/reservations/availability")
def reservation_availability(
    start_time: str = None,
    end_time: str = None,
    zone: str = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    try:
        parsed_start = _parse_iso_datetime(start_time) if start_time else None
        parsed_end = _parse_iso_datetime(end_time) if end_time else None
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid start or end time")

    start_dt, normalized_end = _reservation_window(parsed_start)
    end_dt = parsed_end if parsed_end and parsed_end > start_dt else normalized_end
    end_dt = start_dt + timedelta(minutes=RESERVATION_DURATION_MINUTES)
    return _reservation_availability_payload(db, start_dt, end_dt, zone=zone)


@app.get("/reservations")
def reservation_list(
    status: str = None,
    search: str = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    query = _reservation_query(db, status=status, search=search)
    if user.role not in {"admin", "operator"}:
        query = query.filter(Reservation.created_by_user_id == user.id)
    reservations = (
        query
        .order_by(Reservation.start_time.asc(), Reservation.id.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    return {"reservations": [_serialize_reservation(reservation) for reservation in reservations]}


@app.post("/reservations")
def reservation_create(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "operator")),
):
    result = _create_reservation_record(data, db, creator_user_id=user.id)
    if result.get("waitlist"):
        return {
            "waitlist": _serialize_waitlist(result["waitlist"]),
            "message": result.get("message"),
            "alternatives": result.get("alternatives", []),
        }
    return {
        "reservation": _serialize_reservation(result["reservation"]),
        "reservation_window_minutes": result["reservation_window_minutes"],
        "slot_changed": result["slot_changed"],
        "alternatives": result.get("alternatives", []),
    }


@app.post("/reservations/{reservation_id}/cancel")
def reservation_cancel(
    reservation_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin", "operator")),
):
    reservation = db.query(Reservation).filter(Reservation.id == reservation_id).first()
    return _cancel_reservation_record(db, reservation)


@app.get("/lots")
def lots_list(
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    lots = db.query(ParkingLot).order_by(ParkingLot.name.asc(), ParkingLot.id.asc()).all()
    return {"lots": [_serialize_lot(lot) for lot in lots]}


@app.post("/lots")
def lots_create(
    data: dict,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin", "operator")),
):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Lot name is required")
    code = (data.get("code") or name.lower().replace(" ", "-")).strip()
    if db.query(ParkingLot).filter((ParkingLot.code == code) | (ParkingLot.name == name)).first():
        raise HTTPException(status_code=409, detail="Lot already exists")
    lot = ParkingLot(
        code=code,
        name=name,
        address=(data.get("address") or "").strip() or None,
        total_slots=int(data.get("total_slots") or 0),
        is_active=bool(data.get("is_active", True)),
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return {"lot": _serialize_lot(lot)}


@app.put("/lots/{lot_id}")
def lots_update(
    lot_id: int,
    data: dict,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin", "operator")),
):
    lot = db.query(ParkingLot).filter(ParkingLot.id == lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")
    lot.name = (data.get("name") or lot.name).strip()
    lot.code = (data.get("code") or lot.code).strip()
    lot.address = (data.get("address") or lot.address or "").strip() or None
    lot.total_slots = int(data.get("total_slots") if data.get("total_slots") is not None else lot.total_slots)
    lot.is_active = bool(data.get("is_active", lot.is_active))
    db.commit()
    db.refresh(lot)
    return {"lot": _serialize_lot(lot)}


@app.get("/waitlist")
def waitlist_list(
    status: str = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    _expire_stale_reservations(db)
    query = db.query(WaitlistEntry)
    if status:
        query = query.filter(WaitlistEntry.status == status)
    entries = query.order_by(WaitlistEntry.created_at.asc(), WaitlistEntry.id.asc()).all()
    return {"entries": [_serialize_waitlist(entry) for entry in entries]}


@app.post("/waitlist")
def waitlist_create(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "operator")),
):
    try:
        requested_start = _parse_iso_datetime(data.get("start_time")) if data.get("start_time") else None
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid waitlist time")
    start_dt, end_dt = _reservation_window(requested_start)
    full_name = (data.get("full_name") or "").strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Guest name is required")

    entry = WaitlistEntry(
        lot_name=(data.get("lot_name") or "Main Lot").strip() or "Main Lot",
        zone=(data.get("zone") or "A").strip().upper() or "A",
        full_name=full_name,
        email=(data.get("email") or "").strip() or None,
        phone=(data.get("phone") or "").strip() or None,
        license_plate=(data.get("license_plate") or "").strip().upper() or None,
        user_type=_effective_user_type(data.get("user_type")),
        start_time=start_dt,
        end_time=end_dt,
        status="waiting",
        notes=(data.get("notes") or "").strip() or None,
        created_by_user_id=user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"entry": _serialize_waitlist(entry)}


@app.post("/waitlist/{entry_id}/promote")
def waitlist_promote(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "operator")),
):
    _expire_stale_reservations(db)
    entry = db.query(WaitlistEntry).filter(WaitlistEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Waitlist entry not found")
    if entry.status != "waiting":
        raise HTTPException(status_code=400, detail="Only waiting entries can be promoted")

    selected_slot = _find_available_slot(db, entry.start_time, entry.end_time, entry.zone)
    if not selected_slot:
        raise HTTPException(status_code=409, detail="No slot available for this waitlist entry")

    confirmation_code = generate_confirmation_code()
    while db.query(Reservation).filter(Reservation.confirmation_code == confirmation_code).first():
        confirmation_code = generate_confirmation_code()

    reservation = Reservation(
        confirmation_code=confirmation_code,
        lot_name=entry.lot_name,
        slot_id=selected_slot["slot_id"],
        zone=selected_slot["zone"],
        full_name=entry.full_name,
        email=entry.email,
        phone=entry.phone,
        license_plate=entry.license_plate,
        start_time=entry.start_time,
        end_time=entry.end_time,
        status="confirmed",
        payment_status="pending",
        notes=json.dumps({"notes": entry.notes, "user_type": entry.user_type}),
        created_by_user_id=user.id,
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)

    entry.status = "promoted"
    entry.promoted_reservation_id = reservation.id
    db.commit()
    db.refresh(entry)
    return {"entry": _serialize_waitlist(entry), "reservation": _serialize_reservation(reservation)}


@app.post("/waitlist/{entry_id}/cancel")
def waitlist_cancel(
    entry_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin", "operator")),
):
    entry = db.query(WaitlistEntry).filter(WaitlistEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Waitlist entry not found")
    entry.status = "cancelled"
    db.commit()
    db.refresh(entry)
    return {"entry": _serialize_waitlist(entry)}


@app.get("/incidents")
def incidents_list(
    status: str = None,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    if user.role in {"admin", "operator"}:
        query = db.query(IncidentReport)
    else:
        query = db.query(IncidentReport).filter(IncidentReport.reported_by_user_id == user.id)
    if status:
        query = query.filter(IncidentReport.status == status)
    incidents = query.order_by(IncidentReport.created_at.desc(), IncidentReport.id.desc()).all()
    return {"incidents": [_serialize_incident(item) for item in incidents]}


@app.post("/incidents")
def incidents_create(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    title = (data.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Incident title is required")
    incident = IncidentReport(
        lot_name=(data.get("lot_name") or "Main Lot").strip() or "Main Lot",
        slot_id=(data.get("slot_id") or "").strip() or None,
        severity=(data.get("severity") or "medium").strip().lower() or "medium",
        category=(data.get("category") or "general").strip().lower() or "general",
        title=title,
        description=(data.get("description") or "").strip() or None,
        image_path=(data.get("image_path") or "").strip() or None,
        reporter_name=(data.get("reporter_name") or user.full_name or user.username).strip() or None,
        reported_by_user_id=user.id,
        status=(data.get("status") or "open").strip().lower() or "open",
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return {"incident": _serialize_incident(incident)}


@app.post("/incidents/upload")
async def incidents_upload(
    file: UploadFile = File(...),
    user: User = Depends(_get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Unsupported incident image type")

    incident_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "..", "uploads", "incidents"))
    os.makedirs(incident_dir, exist_ok=True)
    target = os.path.join(incident_dir, f"incident_{uuid.uuid4().hex}{ext}")
    with open(target, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"image_path": target, "uploaded_by": user.username}


@app.post("/incidents/{incident_id}/resolve")
def incidents_resolve(
    incident_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin", "operator")),
):
    incident = db.query(IncidentReport).filter(IncidentReport.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.status = "resolved"
    db.commit()
    db.refresh(incident)
    return {"incident": _serialize_incident(incident)}


@app.post("/incidents/{incident_id}/status")
def incidents_update_status(
    incident_id: int,
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    incident = db.query(IncidentReport).filter(IncidentReport.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    new_status = (data.get("status") or "").strip().lower()
    if new_status not in {"open", "investigating", "resolved", "closed"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    incident.status = new_status
    db.commit()
    db.refresh(incident)
    return {"incident": _serialize_incident(incident)}


@app.get("/analytics/forecast")
def analytics_forecast(
    hours: int = 6,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    return {"data": _forecast_occupancy_points(db, hours=hours)}


@app.get("/integrations/tokens")
def integration_tokens(
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin")),
):
    records = db.query(ApiToken).order_by(ApiToken.created_at.desc(), ApiToken.id.desc()).all()
    return {
        "tokens": [
            {
                "id": item.id,
                "name": item.name,
                "role": item.role,
                "rate_limit_per_minute": item.rate_limit_per_minute,
                "last_used_at": item.last_used_at.isoformat() + "Z" if item.last_used_at else None,
                "is_active": bool(item.is_active),
                "created_at": item.created_at.isoformat() + "Z" if item.created_at else None,
            }
            for item in records
        ]
    }


@app.post("/integrations/tokens")
def integration_token_create(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin")),
):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Token name is required")
    raw_token = _generate_api_token_value()
    record = ApiToken(
        name=name,
        token_hash=_token_hash(raw_token),
        role="integration",
        rate_limit_per_minute=int(data.get("rate_limit_per_minute") or 60),
        created_by_user_id=user.id,
        is_active=True,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "token": raw_token,
        "record": {
            "id": record.id,
            "name": record.name,
            "rate_limit_per_minute": record.rate_limit_per_minute,
            "created_at": record.created_at.isoformat() + "Z" if record.created_at else None,
        },
    }


@app.post("/integrations/tokens/{token_id}/revoke")
def integration_token_revoke(
    token_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin")),
):
    record = db.query(ApiToken).filter(ApiToken.id == token_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Token not found")
    record.is_active = False
    db.commit()
    return {"message": "Token revoked"}


@app.get("/integrations/parking/summary")
def integration_parking_summary(
    db: Session = Depends(get_db),
    token_record: ApiToken = Depends(_get_api_token_record),
):
    slots = get_all_slots(db)
    status_map = {slot.id: slot.status for slot in slots}
    stats = get_parking_statistics(status_map)
    stats["token_name"] = token_record.name
    return {"stats": stats, "generated_at": datetime.utcnow().isoformat() + "Z"}


@app.get("/payments/config")
def payments_config(user: User = Depends(_get_current_user)):
    qr_config = _admin_qr_payment_config()
    return {
        "enabled": qr_config["enabled"],
        "provider": qr_config["provider"],
        "payment_method": qr_config["method"],
        "receiver_name": qr_config["receiver_name"],
        "qr_code": qr_config["qr_code"],
        "instructions": qr_config["instructions"],
        "monthly_pass_catalog": [],
        "user_role": user.role,
    }


@app.get("/payments")
def payments_list(
    limit: int = 100,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    query = db.query(PaymentRecord)
    if user.role not in {"admin", "operator"}:
        query = query.filter(PaymentRecord.user_id == user.id)
    records = query.order_by(PaymentRecord.created_at.desc(), PaymentRecord.id.desc()).limit(max(1, min(limit, 500))).all()
    return {"payments": [_payment_record_payload(record) for record in records]}


@app.post("/payments/reservations/{reservation_id}/checkout")
def reservation_checkout(
    reservation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "operator")),
):
    reservation = db.query(Reservation).filter(Reservation.id == reservation_id).first()
    return _prepare_reservation_payment(db, reservation, user_id=user.id)


@app.get("/public/reservations/availability")
def public_reservation_availability(
    zone: str = None,
    db: Session = Depends(get_db),
):
    start_dt, end_dt = _reservation_window()
    return _reservation_availability_payload(db, start_dt, end_dt, zone=zone)


@app.get("/public/slots/live")
def public_live_slots(
    db: Session = Depends(get_db),
):
    slots_path = _get_slots_path_for_current_source()
    total_from_json = 0
    polygon_data = []
    try:
        if os.path.exists(slots_path):
            with open(slots_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            polygon_data = data.get("parking_areas", [])
            total_from_json = len(polygon_data)
    except Exception:
        pass

    snapshot = _slot_state_snapshot(db, datetime.utcnow(), datetime.utcnow())
    slot_states = snapshot.get("slot_states", [])
    
    slot_map = {s["slot_id"]: s["state"] for s in slot_states}
    
    live_slots = []
    for idx, polygon in enumerate(polygon_data):
        slot_id = f"S{idx + 1}"
        live_slots.append({
            "slot_id": slot_id,
            "zone": polygon.get("zone", "A"),
            "state": slot_map.get(slot_id, "available"),
            "points": polygon.get("points", []),
        })
    
    occupied_count = len([s for s in live_slots if s["state"] == "occupied"])
    reserved_count = len([s for s in live_slots if s["state"] == "reserved"])
    available_count = total_from_json - occupied_count - reserved_count
    
    return {
        "total_slots": total_from_json,
        "available": available_count,
        "occupied": occupied_count,
        "reserved": reserved_count,
        "slot_states": live_slots,
    }


@app.post("/public/reservations")
def public_reservation_create(
    data: dict,
    db: Session = Depends(get_db),
    authorization: str = Header(None),
):
    try:
        from .security import get_current_active_user_optional
    except ImportError:
        from security import get_current_active_user_optional
    current_user = get_current_active_user_optional(authorization, db)
    creator_user_id = current_user.id if current_user else None
    result = _create_reservation_record(data, db, creator_user_id=creator_user_id)
    if result.get("waitlist"):
        return {
            "waitlist": _serialize_waitlist(result["waitlist"]),
            "message": result.get("message"),
            "alternatives": result.get("alternatives", []),
        }
    return {
        "reservation": _serialize_reservation(result["reservation"]),
        "reservation_window_minutes": result["reservation_window_minutes"],
        "slot_changed": result["slot_changed"],
        "alternatives": result.get("alternatives", []),
    }


@app.get("/public/reservations/lookup")
def public_reservation_lookup(
    confirmation_code: str = None,
    license_plate: str = None,
    db: Session = Depends(get_db),
):
    if not (confirmation_code or license_plate):
        raise HTTPException(status_code=400, detail="Confirmation code or license plate is required")
    _expire_stale_reservations(db)
    reservation = _resolve_public_reservation(
        db,
        confirmation_code=confirmation_code,
        license_plate=license_plate,
    )
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")
    payment_record = (
        db.query(PaymentRecord)
        .filter(PaymentRecord.reservation_id == reservation.id)
        .order_by(PaymentRecord.created_at.desc(), PaymentRecord.id.desc())
        .first()
    )
    return {
        "reservation": _serialize_reservation(reservation),
        "payment": _payment_record_payload(payment_record) if payment_record else None,
    }


@app.get("/cashier/reservations/lookup")
def cashier_reservation_lookup(
    query: str = None,
    license_plate: str = None,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin", "cashier")),
):
    if not (query or license_plate):
        raise HTTPException(status_code=400, detail="Reservation query or license plate is required")

    reservation = _resolve_cashier_reservation(
        db,
        query=query,
        license_plate=license_plate,
    )
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    payment_record = _latest_reservation_payment(db, reservation.id)
    amount_payload = _reservation_amount_payload(reservation)
    return {
        "reservation": _serialize_reservation(reservation),
        "payment": _payment_record_payload(payment_record) if payment_record else None,
        "amount_due": amount_payload["amount"],
        "currency": amount_payload["currency"],
    }


@app.get("/public/reservations/by-phone")
def public_reservations_by_phone(
    phone: str = None,
    db: Session = Depends(get_db),
):
    if not phone:
        return {"reservations": []}
    _expire_stale_reservations(db)
    reservations = db.query(Reservation).filter(
        Reservation.phone == phone
    ).order_by(Reservation.created_at.desc()).limit(20).all()
    return {"reservations": [_serialize_reservation(r) for r in reservations]}


@app.get("/public/reservations/by-license")
def public_reservations_by_license(
    license_plate: str = None,
    db: Session = Depends(get_db),
):
    if not license_plate:
        return {"reservations": [], "active_session": None}
    _expire_stale_reservations(db)
    reservations = db.query(Reservation).filter(
        Reservation.license_plate.ilike(license_plate)
    ).order_by(Reservation.created_at.desc()).limit(20).all()
    
    active_session = None
    active_reservation = None
    
    for res in reservations:
        if res.status in ('confirmed', 'checked_in', 'active') and res.payment_status == 'paid':
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            start = res.start_time
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if now >= start:
                duration_minutes = int((now - start).total_seconds() / 60)
                zone = res.zone or "A"
                
                settings_data = _load_runtime_settings()
                zone_pricing = settings_data.get("zone_pricing", {"A": 2, "B": 1, "C": 4})
                hourly_rate = zone_pricing.get(zone, 2)
                amount_due = round((duration_minutes / 60) * hourly_rate, 2)
                
                active_session = {
                    "session_id": res.id,
                    "license_plate": res.license_plate,
                    "slot_id": res.slot_id or "Auto",
                    "zone": zone,
                    "entry_time": res.start_time.isoformat() + "Z" if res.start_time else None,
                    "duration_minutes": duration_minutes,
                    "hourly_rate": hourly_rate,
                    "amount_due": amount_due,
                    "payment_method": res.payment_method,
                    "confirmation_code": res.confirmation_code,
                }
                active_reservation = res
                break
    
    return {
        "reservations": [_serialize_reservation(r) for r in reservations],
        "active_session": active_session,
    }


@app.get("/public/reservations/my")
def public_my_reservations(
    db: Session = Depends(get_db),
    authorization: str = Header(None),
):
    try:
        from .security import get_current_active_user_optional
    except ImportError:
        from security import get_current_active_user_optional
    current_user = get_current_active_user_optional(authorization, db)
    if not current_user:
        return {"reservations": [], "active_session": None}
    _expire_stale_reservations(db)
    reservations = db.query(Reservation).filter(
        Reservation.created_by_user_id == current_user.id
    ).order_by(Reservation.created_at.desc()).limit(20).all()
    
    active_session = None
    for res in reservations:
        if res.status in ('confirmed', 'checked_in', 'active') and res.payment_status == 'paid':
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            start = res.start_time
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if now >= start:
                duration_minutes = int((now - start).total_seconds() / 60)
                zone = res.zone or "A"
                
                settings_data = _load_runtime_settings()
                zone_pricing = settings_data.get("zone_pricing", {"A": 2, "B": 1, "C": 4})
                hourly_rate = zone_pricing.get(zone, 2)
                amount_due = round((duration_minutes / 60) * hourly_rate, 2)
                
                active_session = {
                    "session_id": res.id,
                    "license_plate": res.license_plate,
                    "slot_id": res.slot_id or "Auto",
                    "zone": zone,
                    "entry_time": res.start_time.isoformat() + "Z" if res.start_time else None,
                    "duration_minutes": duration_minutes,
                    "hourly_rate": hourly_rate,
                    "amount_due": amount_due,
                    "payment_method": res.payment_method,
                    "confirmation_code": res.confirmation_code,
                }
                break
    
    return {
        "reservations": [_serialize_reservation(r) for r in reservations],
        "active_session": active_session,
    }


@app.post("/public/payments/reservations/{confirmation_code}")
def public_reservation_payment_checkout(
    confirmation_code: str,
    db: Session = Depends(get_db),
):
    reservation = _resolve_public_reservation(db, confirmation_code=confirmation_code)
    return _prepare_reservation_payment(db, reservation, user_id=None)


@app.post("/public/payments/reservations/by-plate/{license_plate}")
def public_reservation_payment_checkout_by_plate(
    license_plate: str,
    db: Session = Depends(get_db),
):
    reservation = _resolve_public_reservation(db, license_plate=license_plate)
    return _prepare_reservation_payment(db, reservation, user_id=None)


@app.get("/public/monthly-passes")
def public_monthly_passes_catalog(
    db: Session = Depends(get_db),
):
    return {"catalog": _monthly_pass_catalog()}


@app.post("/public/monthly-passes/checkout")
def public_monthly_pass_checkout(
    data: dict,
    db: Session = Depends(get_db),
):
    plan_id = (data.get("plan_id") or "").strip()
    plan = next((item for item in _monthly_pass_catalog() if item["id"] == plan_id), None)
    if not plan:
        raise HTTPException(status_code=404, detail="Monthly pass plan not found")

    full_name = (data.get("full_name") or "").strip() or None
    email = (data.get("email") or "").strip() or None
    phone = (data.get("phone") or "").strip() or None
    license_plate = (data.get("license_plate") or "").strip().upper() or None
    lot_name = (data.get("lot_name") or "Main Lot").strip()

    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required")

    pass_record = MonthlyPass(
        user_id=None,
        plan_id=plan["id"],
        plan_name=plan["name"],
        zone=plan["zone"],
        amount=plan["amount"],
        currency=plan["currency"],
        license_plate=license_plate,
        lot_name=lot_name,
        full_name=full_name,
        email=email,
        phone=phone,
        status="pending",
    )
    db.add(pass_record)
    db.commit()
    db.refresh(pass_record)

    payment_record = PaymentRecord(
        user_id=None,
        payment_type="monthly_pass",
        amount=plan["amount"],
        currency=plan["currency"],
        status="pending",
        payment_method="alipay_qr",
        payment_provider="admin_qr",
        notes=f"Monthly pass: {plan['name']}",
    )
    db.add(payment_record)
    db.commit()
    db.refresh(payment_record)

    qr_config = _admin_qr_payment_config()
    if not qr_config["enabled"]:
        raise HTTPException(status_code=503, detail="Alipay payments are not configured")

    return {
        "pass": _monthly_pass_payload(pass_record),
        "payment_request": {
            "payment_id": payment_record.id,
            "pass_id": pass_record.id,
            "amount": plan["amount"],
            "currency": plan["currency"],
            "receiver_name": qr_config["receiver_name"],
            "qr_code": qr_config["qr_code"],
            "instructions": qr_config["instructions"],
            "status": "pending",
        },
    }


@app.post("/public/monthly-passes/{pass_id}/pay")
def public_monthly_pass_pay(
    pass_id: int,
    db: Session = Depends(get_db),
):
    pass_record = db.query(MonthlyPass).filter(MonthlyPass.id == pass_id).first()
    if not pass_record:
        raise HTTPException(status_code=404, detail="Monthly pass not found")
    if pass_record.status == "active":
        raise HTTPException(status_code=400, detail="Monthly pass is already active")

    payment_record = (
        db.query(PaymentRecord)
        .filter(PaymentRecord.payment_type == "monthly_pass")
        .filter(PaymentRecord.notes.like(f"%Monthly pass: {pass_record.plan_name}%"))
        .order_by(PaymentRecord.created_at.desc())
        .first()
    )
    if payment_record:
        payment_record.status = "paid"
        payment_record.paid_at = datetime.utcnow()
        pass_record.status = "active"
        pass_record.current_period_start = datetime.utcnow()
        pass_record.current_period_end = datetime.utcnow() + timedelta(days=30)
        db.commit()

    return {
        "pass": _monthly_pass_payload(pass_record),
        "message": "Monthly pass activated successfully",
    }


@app.post("/public/incidents")
def public_incident_create(
    data: dict,
    db: Session = Depends(get_db),
):
    title = (data.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Incident title is required")
    
    image_path = None
    image_data = data.get("image_data") or ""
    if image_data and "," in image_data and image_data.startswith("data:image"):
        try:
            import base64
            import uuid
            parts = image_data.split(",", 1)
            if len(parts) != 2:
                raise ValueError("Invalid base64 format")
            b64data = parts[1]
            header = parts[0]
            ext = "jpg"
            if "png" in header:
                ext = "png"
            elif "webp" in header:
                ext = "webp"
            file_data = base64.b64decode(b64data)
            filename = f"incident_{uuid.uuid4().hex[:8]}.{ext}"
            upload_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
            os.makedirs(upload_dir, exist_ok=True)
            file_path = os.path.join(upload_dir, filename)
            with open(file_path, "wb") as f:
                f.write(file_data)
            image_path = f"/uploads/{filename}"
        except Exception as e:
            pass
    
    incident = IncidentReport(
        lot_name=(data.get("lot_name") or "Main Lot").strip() or "Main Lot",
        slot_id=(data.get("slot_id") or "").strip() or None,
        severity=(data.get("severity") or "medium").strip().lower() or "medium",
        category=(data.get("category") or "general").strip().lower() or "general",
        title=title,
        description=(data.get("description") or "").strip() or None,
        image_path=image_path,
        reporter_name=(data.get("reporter_name") or "Guest").strip() or None,
        reported_by_user_id=None,
        status="open",
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return {"incident": _serialize_incident(incident)}


@app.get("/public/incidents")
def public_incident_list(
    reporter: str = None,
    db: Session = Depends(get_db),
):
    query = db.query(IncidentReport)
    if reporter:
        query = query.filter(IncidentReport.reporter_name == reporter)
    else:
        query = query.filter(IncidentReport.reporter_name == None)
    incidents = query.order_by(IncidentReport.created_at.desc()).all()
    return {"incidents": [_serialize_incident(item) for item in incidents]}


@app.post("/public/incidents/{incident_id}/status")
def public_incident_update_status(
    incident_id: int,
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    incident = db.query(IncidentReport).filter(IncidentReport.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    new_status = (data.get("status") or "").strip().lower()
    if new_status not in {"open", "investigating", "resolved", "closed"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    incident.status = new_status
    db.commit()
    return {"incident": _serialize_incident(incident)}


@app.post("/public/reservations/{confirmation_code}/checkout")
def public_reservation_checkout(
    confirmation_code: str,
    db: Session = Depends(get_db),
):
    reservation = _resolve_public_reservation(db, confirmation_code=confirmation_code)
    return _cancel_reservation_record(db, reservation)


@app.post("/public/reservations/by-plate/{license_plate}/checkout")
def public_reservation_checkout_by_plate(
    license_plate: str,
    db: Session = Depends(get_db),
):
    reservation = _resolve_public_reservation(db, license_plate=license_plate)
    return _cancel_reservation_record(db, reservation)


@app.post("/public/auth/send-otp")
def public_send_otp(
    data: dict,
    db: Session = Depends(get_db),
):
    phone = (data.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")
    
    original_phone = phone
    phone = re.sub(r'[^\d]', '', phone)
    
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Phone number too short")
    
    if phone.startswith('0'):
        phone = phone[1:]
    
    if not phone.startswith('1') and len(phone) >= 10:
        phone = '1' + phone
    
    if len(phone) > 15:
        phone = phone[-11:]
        if not phone.startswith('1'):
            phone = '1' + phone[-10:]
    
    print(f"[OTP] Original: {original_phone} -> Normalized: {phone}")
    
    # Check existing unused OTPs
    existing = db.query(PhoneOTP).filter(
        PhoneOTP.phone == phone,
        PhoneOTP.purpose == "login",
        PhoneOTP.used == False,
        PhoneOTP.expires_at > datetime.utcnow()
    ).all()
    print(f"[OTP] Existing valid OTPs: {len(existing)}")
    
    # Mark all previous OTPs as used
    db.query(PhoneOTP).filter(
        PhoneOTP.phone == phone,
        PhoneOTP.purpose == "login",
        PhoneOTP.used == False
    ).update({"used": True})
    
    otp = generate_otp()
    
    otp_record = PhoneOTP(
        phone=phone,
        otp_hash=otp,  # Store plain OTP for simplicity
        purpose="login",
        expires_at=datetime.utcnow() + timedelta(minutes=10),
    )
    db.add(otp_record)
    db.commit()
    
    print(f"[OTP] Phone {phone}: {otp}")
    
    return {"message": "OTP sent to your phone", "expires_in": 600, "debug_otp": otp}


@app.post("/public/auth/login")
def public_login(
    data: dict,
    db: Session = Depends(get_db),
):
    phone = (data.get("phone") or "").strip()
    otp = (data.get("otp") or "").strip()
    
    if not phone or not otp:
        raise HTTPException(status_code=400, detail="Phone and OTP are required")
    
    phone = re.sub(r'[^\d]', '', phone)
    
    if phone.startswith('0'):
        phone = phone[1:]
    
    if not phone.startswith('1'):
        phone = '1' + phone
    
    if len(phone) > 15:
        phone = phone[-11:]
        if not phone.startswith('1'):
            phone = '1' + phone[-10:]
    
    otp_record = db.query(PhoneOTP).filter(
        PhoneOTP.phone == phone,
        PhoneOTP.purpose == "login",
        PhoneOTP.used == False,
        PhoneOTP.expires_at > datetime.utcnow()
    ).order_by(PhoneOTP.created_at.desc()).first()

    print(f"[LOGIN] Looking for OTP for phone: {phone}")
    print(f"[LOGIN] Found OTP record: {otp_record}")
    
    if not otp_record:
        raise HTTPException(status_code=401, detail="No OTP found - please request a new OTP")
    
    print(f"[LOGIN] Verifying OTP: input={otp}, stored_hash={otp_record.otp_hash}")
    
    # Simple comparison for plain OTPs (no hash)
    is_valid = otp == otp_record.otp_hash
    print(f"[LOGIN] Verification result: {is_valid}")
    
    if not is_valid:
        print(f"[LOGIN] OTP verification failed for phone: {phone}")
        raise HTTPException(status_code=401, detail="Invalid OTP")
    
    otp_record.used = True
    db.commit()
    
    user = db.query(User).filter(User.phone == phone).first()
    
    if not user:
        user = User(
            username=f"user_{phone[-8:]}",
            phone=phone,
            role="user",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    token = create_access_token(user.username, user.role)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "phone": user.phone,
            "role": user.role,
        }
    }


@app.get("/public/auth/me")
def public_auth_me(
    db: Session = Depends(get_db),
    authorization: str = Header(None),
):
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    user = db.query(User).filter(User.username == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "phone": user.phone,
            "role": user.role,
        }
    }


@app.post("/payments/{payment_id}/mark-paid")
def payments_mark_paid(
    payment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_roles("admin", "operator")),
):
    payment_record = db.query(PaymentRecord).filter(PaymentRecord.id == payment_id).first()
    if not payment_record:
        raise HTTPException(status_code=404, detail="Payment not found")

    payment_record.status = "paid"
    payment_record.paid_at = payment_record.paid_at or datetime.utcnow()
    payment_record.payment_method = payment_record.payment_method or "alipay_qr"
    payment_record.payment_provider = payment_record.payment_provider or "admin_qr"

    reservation_payload = None
    if payment_record.reservation_id:
        reservation = db.query(Reservation).filter(Reservation.id == payment_record.reservation_id).first()
        if reservation:
            reservation.payment_status = "paid"
            reservation.payment_method = payment_record.payment_method
            reservation.payment_provider = payment_record.payment_provider
            reservation_payload = _serialize_reservation(reservation)

    if payment_record.monthly_pass_id:
        monthly_pass = db.query(MonthlyPass).filter(MonthlyPass.id == payment_record.monthly_pass_id).first()
        if monthly_pass:
            monthly_pass.status = "active"

    db.commit()
    db.refresh(payment_record)

    return {
        "payment": _payment_record_payload(payment_record),
        "reservation": reservation_payload,
    }


@app.put("/cashier/reservations/{reservation_id}/payment-status")
def cashier_update_reservation_payment_status(
    reservation_id: int,
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "cashier")),
):
    payment_status = str(data.get("payment_status") or "").strip().lower()
    if payment_status not in {"paid", "pending"}:
        raise HTTPException(status_code=400, detail="Payment status must be paid or pending")
    payment_method = str(data.get("payment_method") or "cash").strip().lower()
    if payment_method not in {"cash", "card", "mobile"}:
        payment_method = "cash"
    notes = (data.get("notes") or "").strip() or None
    amount_received = data.get("amount_received")
    try:
        amount_received_value = float(amount_received) if amount_received not in (None, "") else None
    except Exception:
        amount_received_value = None

    reservation = db.query(Reservation).filter(Reservation.id == reservation_id).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    if reservation.status in {"cancelled", "expired"}:
        raise HTTPException(status_code=400, detail="This reservation cannot be updated")

    amount_payload = _reservation_amount_payload(reservation)
    payment_record = _latest_reservation_payment(db, reservation.id)
    latest_cash_payment = (
        db.query(CashPayment)
        .filter(CashPayment.reservation_id == reservation.id)
        .order_by(CashPayment.created_at.desc(), CashPayment.id.desc())
        .first()
    )

    payment_provider = {
        "cash": "cashier_cash",
        "card": "cashier_card",
        "mobile": "cashier_mobile",
    }.get(payment_method, "cashier_cash")
    change_due = None
    if amount_received_value is not None:
        change_due = round(max(0, amount_received_value - float(amount_payload["amount"] or 0)), 2)

    if payment_status == "paid":
        reservation.payment_method = payment_method
        reservation.payment_provider = payment_provider

    if payment_record is None:
        payment_record = PaymentRecord(
            user_id=user.id,
            reservation_id=reservation.id,
            amount=amount_payload["amount"],
            currency=str(amount_payload["currency"] or "USD").lower(),
            payment_type="reservation",
            payment_method=payment_method if payment_status == "paid" else (reservation.payment_method or payment_method),
            payment_provider=payment_provider if payment_status == "paid" else (reservation.payment_provider or payment_provider),
            status=payment_status,
            paid_at=datetime.utcnow() if payment_status == "paid" else None,
            metadata_json=json.dumps({
                "confirmation_code": reservation.confirmation_code,
                "full_name": reservation.full_name,
                "phone": reservation.phone,
                "license_plate": reservation.license_plate,
                "slot_id": reservation.slot_id,
                "zone": reservation.zone,
                "payment_method": payment_method,
                "notes": notes,
                "amount_received": amount_received_value,
                "change_due": change_due,
                "updated_by_user_id": user.id,
                "updated_from": "cashier_dashboard",
            }),
        )
        db.add(payment_record)
    else:
        payment_record.user_id = user.id
        payment_record.amount = amount_payload["amount"]
        payment_record.currency = str(amount_payload["currency"] or payment_record.currency or "USD").lower()
        payment_record.payment_method = payment_method if payment_status == "paid" else (payment_record.payment_method or reservation.payment_method or payment_method)
        payment_record.payment_provider = payment_provider if payment_status == "paid" else (payment_record.payment_provider or reservation.payment_provider or payment_provider)
        payment_record.status = payment_status
        payment_record.paid_at = datetime.utcnow() if payment_status == "paid" else None
        metadata = {}
        if payment_record.metadata_json:
            try:
                metadata = json.loads(payment_record.metadata_json) or {}
            except Exception:
                metadata = {}
        metadata.update({
            "confirmation_code": reservation.confirmation_code,
            "full_name": reservation.full_name,
            "phone": reservation.phone,
            "license_plate": reservation.license_plate,
            "slot_id": reservation.slot_id,
            "zone": reservation.zone,
            "payment_method": payment_method,
            "notes": notes,
            "amount_received": amount_received_value,
            "change_due": change_due,
            "updated_by_user_id": user.id,
            "updated_from": "cashier_dashboard",
        })
        payment_record.metadata_json = json.dumps(metadata)

    reservation.payment_status = payment_status
    if payment_status == "paid":
        reservation.payment_method = payment_method
        reservation.payment_provider = payment_provider
        if payment_method == "cash":
            if latest_cash_payment is None:
                latest_cash_payment = CashPayment(
                    reservation_id=reservation.id,
                    amount=amount_payload["amount"],
                    currency=amount_payload["currency"],
                    received_by=user.id,
                    status="completed",
                    notes=notes or "Marked paid from cashier dashboard",
                )
                db.add(latest_cash_payment)
            else:
                latest_cash_payment.amount = amount_payload["amount"]
                latest_cash_payment.currency = amount_payload["currency"]
                latest_cash_payment.received_by = user.id
                latest_cash_payment.status = "completed"
                latest_cash_payment.notes = notes or latest_cash_payment.notes or "Marked paid from cashier dashboard"
        elif latest_cash_payment and latest_cash_payment.status == "completed":
            latest_cash_payment.status = "voided"
    else:
        (
            db.query(CashPayment)
            .filter(
                CashPayment.reservation_id == reservation.id,
                CashPayment.status == "completed",
            )
            .update({"status": "voided"}, synchronize_session=False)
        )

    db.commit()
    db.refresh(reservation)
    db.refresh(payment_record)
    latest_cash_payment = (
        db.query(CashPayment)
        .filter(CashPayment.reservation_id == reservation.id)
        .order_by(CashPayment.created_at.desc(), CashPayment.id.desc())
        .first()
    )

    return {
        "reservation": _serialize_reservation(reservation),
        "payment": _payment_record_payload(payment_record),
        "cash_payment": _cash_payment_payload(latest_cash_payment, reservation, user) if latest_cash_payment else None,
        "amount_due": amount_payload["amount"],
        "currency": amount_payload["currency"],
        "payment_method": payment_method,
        "change_due": change_due,
    }


@app.post("/cash-payments")
def cash_payment_create(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "cashier")),
):
    reservation_id = data.get("reservation_id")
    amount = data.get("amount")
    notes = data.get("notes", "")

    if not reservation_id:
        raise HTTPException(status_code=400, detail="Reservation ID is required")
    if not amount or amount <= 0:
        raise HTTPException(status_code=400, detail="Valid amount is required")

    reservation = db.query(Reservation).filter(Reservation.id == reservation_id).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    cash_payment = CashPayment(
        reservation_id=reservation_id,
        amount=float(amount),
        currency="USD",
        received_by=user.id,
        status="completed",
        notes=notes,
    )
    db.add(cash_payment)

    reservation.payment_status = "paid"
    reservation.payment_method = "cash"
    reservation.payment_provider = "cashier"

    payment_record = PaymentRecord(
        user_id=user.id,
        reservation_id=reservation_id,
        amount=float(amount),
        currency="USD",
        payment_type="reservation",
        payment_method="cash",
        payment_provider="cashier",
        status="paid",
        paid_at=datetime.utcnow(),
        metadata_json=json.dumps({
            "notes": notes,
            "confirmation_code": reservation.confirmation_code,
            "slot_id": reservation.slot_id,
            "zone": reservation.zone,
            "updated_by_user_id": user.id,
            "updated_from": "cash_payment_create",
        }),
    )
    db.add(payment_record)
    db.commit()
    db.refresh(cash_payment)
    db.refresh(reservation)

    return {
        "cash_payment": _cash_payment_payload(cash_payment, reservation, user),
        "reservation": _serialize_reservation(reservation),
    }


@app.get("/cash-payments")
def cash_payment_list(
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "cashier")),
):
    query = db.query(CashPayment).filter(CashPayment.status == "completed").order_by(CashPayment.created_at.desc(), CashPayment.id.desc())
    if user.role == "cashier":
        query = query.filter(CashPayment.received_by == user.id)
    payments = query.all()
    reservation_ids = {payment.reservation_id for payment in payments if payment.reservation_id}
    cashier_ids = {payment.received_by for payment in payments if payment.received_by}
    reservations = (
        db.query(Reservation)
        .filter(Reservation.id.in_(reservation_ids))
        .all()
        if reservation_ids
        else []
    )
    cashiers = (
        db.query(User)
        .filter(User.id.in_(cashier_ids))
        .all()
        if cashier_ids
        else []
    )
    reservation_map = {reservation.id: reservation for reservation in reservations}
    cashier_map = {cashier.id: cashier for cashier in cashiers}
    return {
        "cash_payments": [
            _cash_payment_payload(
                p,
                reservation_map.get(p.reservation_id),
                cashier_map.get(p.received_by),
            )
            for p in payments
        ]
    }


@app.get("/cashier/payments")
def cashier_payment_list(
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "cashier")),
):
    records = (
        db.query(PaymentRecord)
        .filter(
            PaymentRecord.payment_type == "reservation",
            PaymentRecord.payment_provider.isnot(None),
        )
        .order_by(PaymentRecord.paid_at.desc(), PaymentRecord.created_at.desc(), PaymentRecord.id.desc())
        .limit(300)
        .all()
    )

    filtered_records = []
    for record in records:
        provider = str(record.payment_provider or "").lower()
        metadata = {}
        if record.metadata_json:
            try:
                metadata = json.loads(record.metadata_json) or {}
            except Exception:
                metadata = {}
        updated_from = str(metadata.get("updated_from") or "").lower()
        if not (provider.startswith("cashier") or updated_from.startswith("cashier_") or updated_from == "cashier_dashboard"):
            continue
        if user.role == "cashier" and record.user_id != user.id:
            continue
        filtered_records.append((record, metadata))

    reservation_ids = {record.reservation_id for record, _ in filtered_records if record.reservation_id}
    cashier_ids = {record.user_id for record, _ in filtered_records if record.user_id}
    reservations = (
        db.query(Reservation)
        .filter(Reservation.id.in_(reservation_ids))
        .all()
        if reservation_ids
        else []
    )
    cashiers = (
        db.query(User)
        .filter(User.id.in_(cashier_ids))
        .all()
        if cashier_ids
        else []
    )
    reservation_map = {reservation.id: reservation for reservation in reservations}
    cashier_map = {cashier.id: cashier for cashier in cashiers}

    return {
        "payments": [
            _cashier_payment_record_payload(
                record,
                reservation_map.get(record.reservation_id),
                cashier_map.get(record.user_id),
            )
            for record, _ in filtered_records
        ]
    }


@app.post("/issues")
def issue_create(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    priority = (data.get("priority") or "medium").strip().lower()

    if not title or not description:
        raise HTTPException(status_code=400, detail="Title and description are required")
    if priority not in {"low", "medium", "high", "critical"}:
        priority = "medium"

    issue = Issue(
        title=title,
        description=description,
        priority=priority,
        status="open",
        reported_by=user.id,
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)

    return {
        "issue": {
            "id": issue.id,
            "title": issue.title,
            "description": issue.description,
            "priority": issue.priority,
            "status": issue.status,
            "reported_by": issue.reported_by,
            "assigned_to": issue.assigned_to,
            "created_at": issue.created_at.isoformat() + "Z" if issue.created_at else None,
        }
    }


@app.get("/issues")
def issue_list(
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin", "cashier")),
):
    query = db.query(Issue).order_by(Issue.created_at.desc(), Issue.id.desc())
    if user.role not in {"admin"}:
        query = query.filter(Issue.reported_by == user.id)
    issues = query.all()
    return {
        "issues": [
            {
                "id": i.id,
                "title": i.title,
                "description": i.description,
                "priority": i.priority,
                "status": i.status,
                "reported_by": i.reported_by,
                "assigned_to": i.assigned_to,
                "resolved_at": i.resolved_at.isoformat() + "Z" if i.resolved_at else None,
                "created_at": i.created_at.isoformat() + "Z" if i.created_at else None,
            }
            for i in issues
        ]
    }


@app.put("/issues/{issue_id}")
def issue_update(
    issue_id: int,
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(_require_roles("admin")),
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    if data.get("status"):
        issue.status = data["status"].strip()
        if issue.status == "resolved":
            issue.resolved_at = datetime.utcnow()
    if data.get("assigned_to"):
        issue.assigned_to = data["assigned_to"]

    db.commit()
    db.refresh(issue)

    return {
        "issue": {
            "id": issue.id,
            "title": issue.title,
            "description": issue.description,
            "priority": issue.priority,
            "status": issue.status,
            "reported_by": issue.reported_by,
            "assigned_to": issue.assigned_to,
            "resolved_at": issue.resolved_at.isoformat() + "Z" if issue.resolved_at else None,
            "created_at": issue.created_at.isoformat() + "Z" if issue.created_at else None,
        }
    }


@app.get("/monthly-passes")
def monthly_passes(
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    query = db.query(MonthlyPass)
    if user.role not in {"admin", "operator"}:
        query = query.filter(MonthlyPass.user_id == user.id)
    records = query.order_by(MonthlyPass.created_at.desc(), MonthlyPass.id.desc()).all()
    return {
        "catalog": _monthly_pass_catalog(),
        "passes": [_monthly_pass_payload(record) for record in records],
    }


@app.post("/monthly-passes/checkout")
def monthly_pass_checkout(
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    stripe_client = _require_stripe()
    plan_id = (data.get("plan_id") or "").strip()
    plan = next((item for item in _monthly_pass_catalog() if item["id"] == plan_id), None)
    if not plan:
        raise HTTPException(status_code=404, detail="Monthly pass plan not found")

    full_name = (data.get("full_name") or user.full_name or user.username or "").strip()
    email = (data.get("email") or user.username or "").strip() or None
    license_plate = (data.get("license_plate") or "").strip().upper() or None
    phone = (data.get("phone") or "").strip() or None
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required")

    customer = _get_or_create_stripe_customer(db, user, email=email, full_name=full_name)
    frontend_base = _frontend_base_from_request(request)

    monthly_pass = MonthlyPass(
        user_id=user.id,
        full_name=full_name,
        email=email,
        phone=phone,
        license_plate=license_plate,
        lot_name=(data.get("lot_name") or "Main Lot").strip() or "Main Lot",
        zone=plan["zone"],
        plan_name=plan["name"],
        amount=plan["amount"],
        currency=plan["currency"],
        interval=plan["interval"],
        status="pending",
        stripe_customer_id=customer.stripe_customer_id,
    )
    db.add(monthly_pass)
    db.commit()
    db.refresh(monthly_pass)

    payment_record = PaymentRecord(
        user_id=user.id,
        monthly_pass_id=monthly_pass.id,
        amount=plan["amount"],
        currency=plan["currency"],
        payment_type="monthly_pass",
        payment_method="card",
        payment_provider="stripe",
        status="pending",
        stripe_customer_id=customer.stripe_customer_id,
        metadata_json=json.dumps({"plan_id": plan["id"], "zone": plan["zone"]}),
    )
    db.add(payment_record)
    db.commit()
    db.refresh(payment_record)

    session = stripe_client.checkout.Session.create(
        mode="subscription",
        customer=customer.stripe_customer_id,
        payment_method_types=["card"],
        line_items=[{
            "price_data": {
                "currency": plan["currency"],
                "unit_amount": int(round(plan["amount"] * 100)),
                "recurring": {"interval": plan["interval"]},
                "product_data": {
                    "name": plan["name"],
                    "description": plan["description"],
                },
            },
            "quantity": 1,
        }],
        success_url=f"{frontend_base}/?page=Passes&checkout=success&pass_id={monthly_pass.id}",
        cancel_url=f"{frontend_base}/?page=Passes&checkout=cancelled&pass_id={monthly_pass.id}",
        metadata={
            "payment_type": "monthly_pass",
            "monthly_pass_id": str(monthly_pass.id),
            "payment_record_id": str(payment_record.id),
        },
    )

    monthly_pass.stripe_checkout_session_id = session.id
    payment_record.stripe_checkout_session_id = session.id
    db.commit()

    return {
        "checkout_url": session.url,
        "monthly_pass": _monthly_pass_payload(monthly_pass),
        "payment": _payment_record_payload(payment_record),
    }


@app.post("/payments/billing-portal")
def billing_portal(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(_get_current_user),
):
    stripe_client = _require_stripe()
    customer = db.query(PaymentCustomer).filter(PaymentCustomer.user_id == user.id).first()
    if not customer or not customer.stripe_customer_id:
        raise HTTPException(status_code=404, detail="No Stripe customer found for this user")

    session = stripe_client.billing_portal.Session.create(
        customer=customer.stripe_customer_id,
        return_url=f"{_frontend_base_from_request(request)}/?page=Passes",
    )
    return {"url": session.url}


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    stripe_client = _require_stripe()
    webhook_secret = _stripe_webhook_secret()
    if not webhook_secret:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is not configured")

    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    try:
        event = stripe_client.Webhook.construct_event(payload=payload, sig_header=signature, secret=webhook_secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Webhook verification failed: {exc}")

    event_type = event.get("type")
    data_object = (event.get("data") or {}).get("object") or {}

    if event_type == "checkout.session.completed":
        session_id = data_object.get("id")
        payment_record = db.query(PaymentRecord).filter(PaymentRecord.stripe_checkout_session_id == session_id).first()
        if payment_record:
            payment_record.status = "paid"
            payment_record.payment_method = (data_object.get("payment_method_types") or [payment_record.payment_method])[0]
            payment_record.stripe_payment_intent_id = data_object.get("payment_intent") or payment_record.stripe_payment_intent_id
            payment_record.stripe_customer_id = data_object.get("customer") or payment_record.stripe_customer_id
            payment_record.paid_at = datetime.utcnow()

            if payment_record.reservation_id:
                reservation = db.query(Reservation).filter(Reservation.id == payment_record.reservation_id).first()
                if reservation:
                    reservation.payment_status = "paid"
                    reservation.payment_method = payment_record.payment_method
                    reservation.payment_provider = "stripe"

            if payment_record.monthly_pass_id:
                monthly_pass = db.query(MonthlyPass).filter(MonthlyPass.id == payment_record.monthly_pass_id).first()
                if monthly_pass:
                    monthly_pass.status = "active"
                    monthly_pass.stripe_customer_id = data_object.get("customer") or monthly_pass.stripe_customer_id
                    if data_object.get("subscription"):
                        monthly_pass.stripe_subscription_id = data_object.get("subscription")
                        _sync_subscription_state(db, monthly_pass.stripe_subscription_id, status="active")

            db.commit()

    elif event_type == "invoice.paid":
        invoice_id = data_object.get("id")
        subscription_id = data_object.get("subscription")
        payment_record = db.query(PaymentRecord).filter(PaymentRecord.stripe_invoice_id == invoice_id).first()
        if payment_record:
            payment_record.status = "paid"
            payment_record.paid_at = datetime.utcnow()
        elif subscription_id:
            monthly_pass = db.query(MonthlyPass).filter(MonthlyPass.stripe_subscription_id == subscription_id).first()
            if monthly_pass:
                payment_record = PaymentRecord(
                    user_id=monthly_pass.user_id,
                    monthly_pass_id=monthly_pass.id,
                    amount=float((data_object.get("amount_paid") or 0) / 100.0),
                    currency=(data_object.get("currency") or monthly_pass.currency or "usd"),
                    payment_type="monthly_pass",
                    payment_method="card",
                    payment_provider="stripe",
                    status="paid",
                    stripe_invoice_id=invoice_id,
                    stripe_customer_id=data_object.get("customer") or monthly_pass.stripe_customer_id,
                    paid_at=datetime.utcnow(),
                )
                db.add(payment_record)
            _sync_subscription_state(db, subscription_id, status="active")
        db.commit()

    elif event_type in {"customer.subscription.updated", "customer.subscription.created", "customer.subscription.deleted"}:
        subscription_id = data_object.get("id")
        status_value = data_object.get("status")
        if event_type == "customer.subscription.deleted":
            status_value = "cancelled"
        _sync_subscription_state(db, subscription_id, status=status_value)

    return {"received": True, "type": event_type}

@app.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file for processing."""
    if not file.filename.endswith(('.mp4', '.avi', '.mov', '.mkv')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only video files are allowed.")
    
    try:
        os.makedirs("videos", exist_ok=True)
        filename = f"{uuid.uuid4()}.mp4"
        with open(f"videos/{filename}", "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"message": f"Video {filename} uploaded successfully", "url": f"/videos/{filename}"}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/parking/upload-feed")
async def upload_feed(file: UploadFile = File(...)):
    """Upload a video or image file and update video source at runtime."""
    if not file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.jpg', '.jpeg', '.png', '.bmp', '.webp')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only video and image files are allowed.")
    
    try:
        ext = os.path.splitext(file.filename)[1].lower() or ".mp4"
        upload_path = os.path.join(VIDEO_DIR, f"uploaded_feed_{uuid.uuid4().hex}{ext}")
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        if not _validate_source_file(upload_path):
            try:
                os.unlink(upload_path)
            except FileNotFoundError:
                pass
            raise HTTPException(status_code=400, detail="Uploaded file could not be opened as a feed")

        previous_upload = getattr(app.state, "uploaded_feed_path", None)
        if previous_upload and previous_upload != upload_path and os.path.exists(previous_upload):
            try:
                os.unlink(previous_upload)
            except OSError:
                pass

        app.state.uploaded_feed_path = upload_path
        # Point processing pipeline to this uploaded file (hot-swap, no restart).
        Config.VIDEO_SOURCE = upload_path
        app.state.active_camera_id = None
        return {
            "message": "Feed uploaded and source updated",
            "source": upload_path,
            "mode": "upload",
            "filename": os.path.basename(upload_path),
        }
    except Exception as e:
        try:
            if "upload_path" in locals() and upload_path and os.path.exists(upload_path):
                os.unlink(upload_path)
        except Exception:
            pass
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/parking/play-uploaded")
async def play_uploaded():
    if os.path.exists("uploaded_video.mp4"):
        Config.VIDEO_SOURCE = "uploaded_video.mp4"
        return {"message": "Playing uploaded video"}
    else:
        return {"error": "No uploaded video found"}

@app.post("/parking/start-camera")
async def start_camera():
    Config.VIDEO_SOURCE = 0
    return {"message": "Camera started"}

@app.post("/parking/stop-camera")
async def stop_camera():
    Config.VIDEO_SOURCE = None
    return {"message": "Camera stopped"}

@app.get("/parking/video-feed")
async def video_feed():
    """Stream video frames from the current video source as an MJPEG stream."""
    return StreamingResponse(generate_latest_frames(), media_type="multipart/x-mixed-replace; boundary=frame")


def _status_frame_bytes(message: str, detail: str = ""):
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    frame[:] = (8, 12, 18)
    cv2.putText(frame, "SmartParking Live Feed", (70, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    cv2.putText(frame, message, (70, 260), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (52, 152, 219), 3)
    if detail:
        cv2.putText(frame, detail, (70, 330), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (190, 198, 207), 2)
    ok, buffer = cv2.imencode(".jpg", frame)
    return buffer.tobytes() if ok else None


_api_app_ref = None


def _live_feed_state():
    global _api_app_ref
    if _api_app_ref is None:
        try:
            import backend.main as main_module
            _api_app_ref = getattr(main_module, 'api_app', None)
        except Exception:
            _api_app_ref = None
    return getattr(_api_app_ref, "state", app.state) if _api_app_ref else app.state

def generate_latest_frames():
    import time
    last_placeholder_key = None
    last_placeholder_frame = None
    while True:
        state = _live_feed_state()
        frame_bytes = getattr(state, "latest_jpeg", None)
        raw_frame_bytes = getattr(state, "latest_raw_jpeg", None)
        if frame_bytes:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(0.05)
            continue

        if raw_frame_bytes:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + raw_frame_bytes + b'\r\n')
            time.sleep(0.1)
            continue

        source = getattr(state, "camera_source", getattr(Config, "VIDEO_SOURCE", None))
        source_mode = _source_mode(source)
        camera_open = bool(getattr(state, "camera_open", False))
        camera_ok = bool(getattr(state, "camera_last_read_ok", False))

        if source_mode == "none":
            message = "No video source selected"
            detail = "Use Webcam or Upload Feed from the controls panel."
        elif camera_open and not camera_ok:
            message = "Feed initializing"
            detail = "The stream is starting. Wait a moment for the first frame."
        elif not camera_open:
            message = "Unable to open video source"
            detail = f"Current mode: {source_mode}. Check camera permission or uploaded file access."
        else:
            message = "Waiting for processed frame"
            detail = "The backend has a source but has not published a frame yet."

        placeholder_key = (message, detail)
        if placeholder_key != last_placeholder_key:
            last_placeholder_key = placeholder_key
            last_placeholder_frame = _status_frame_bytes(message, detail)

        if last_placeholder_frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + last_placeholder_frame + b'\r\n')
        time.sleep(0.25)


@app.get("/parking/snapshot")
async def parking_snapshot(annotated: bool = False):
    """
    Capture a single frame from the current video source and return it as a JPEG image.
    This is used by the slot editor to ensure polygons align with the active feed.
    """
    # Webcam source is 0, which is falsy; treat only None/"" as inactive.
    if Config.VIDEO_SOURCE is None or Config.VIDEO_SOURCE == "":
        raise HTTPException(status_code=404, detail="No active video source")

    state = _live_feed_state()

    # Optionally return the latest annotated frame for dashboard pause/review mode.
    if annotated:
        annotated_bytes = getattr(state, "latest_jpeg", None)
        if annotated_bytes:
            return Response(content=annotated_bytes, media_type="image/jpeg")

    # Prefer using the latest raw frame from the background pipeline to avoid
    # camera contention (opening a second VideoCapture often fails on webcam).
    raw_bytes = getattr(state, "latest_raw_jpeg", None)
    if raw_bytes:
        return Response(content=raw_bytes, media_type="image/jpeg")

    # No frame available yet - return error instead of opening a second VideoCapture
    # which causes webcam contention on macOS/Linux
    raise HTTPException(status_code=503, detail="No frame available yet - camera may still be initializing")

def generate_frames():
    """Generator function to yield video frames as JPEG images."""
    import time

    def scale_points(points, scale_x: float, scale_y: float):
        scaled = []
        for p in points or []:
            if isinstance(p, dict):
                x, y = p.get("x", 0), p.get("y", 0)
            else:
                x, y = p[0], p[1]
            scaled.append((int(x * scale_x), int(y * scale_y)))
        return scaled

    def draw_flow_zone(image, points, color, label):
        if not points or len(points) < 2:
            return
        pts = np.array(points, np.int32)
        cv2.polylines(image, [pts], isClosed=True, color=color, thickness=2)
        if len(points) >= 3:
            overlay = image.copy()
            cv2.fillPoly(overlay, [pts], color)
            cv2.addWeighted(overlay, 0.12, image, 0.88, 0, image)
        label_x = int(points[0][0])
        label_y = max(18, int(points[0][1]) - 10)
        cv2.putText(image, label, (label_x, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    if Config.VIDEO_SOURCE is None or Config.VIDEO_SOURCE == "":
        # Return placeholder frame continuously
        while True:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, "No video source", (200, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            ret, buffer = cv2.imencode('.jpg', frame)
            if ret:
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(1)
        return

    cap, _, _ = open_video_capture(Config.VIDEO_SOURCE)
    if cap is None or not cap.isOpened():
        # Fallback to placeholder frames if source cannot be opened
        while True:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, "Source error", (200, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            ret, buffer = cv2.imencode('.jpg', frame)
            if ret:
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(1)
        return

    # Load parking slots once and scale to video resolution
    parking_polygons = []
    try:
        # Use the same slots file selection logic as the main processing loop.
        slots_path = _get_slots_path_for_current_source()
        with open(slots_path, 'r') as f:
            slots_data = json.load(f)
        raw_areas = slots_data.get('parking_areas', [])
        raw_entry_zone = slots_data.get('entry_zone')
        raw_exit_zone = slots_data.get('exit_zone')
    except Exception:
        raw_areas = []
        raw_entry_zone = None
        raw_exit_zone = None

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1

    frame_width = slots_data.get('frame_width') if 'slots_data' in locals() else None
    frame_height = slots_data.get('frame_height') if 'slots_data' in locals() else None

    if frame_width and frame_height:
        scale_x = width / frame_width
        scale_y = height / frame_height
    else:
        scale_x = scale_y = 1.0

    for area in raw_areas:
        # Support both new {points, zone} and legacy flat array formats
        if isinstance(area, dict) and 'points' in area:
            raw_points = area['points']
            zone = area.get('zone', 'A')
        else:
            raw_points = area
            zone = 'A'
        points = []
        for p in raw_points:
            # Support both dict {"x","y"} and [x, y] formats
            if isinstance(p, dict):
                x, y = p.get('x', 0), p.get('y', 0)
            else:
                x, y = p[0], p[1]
            points.append((int(x * scale_x), int(y * scale_y)))
        if len(points) >= 2:
            parking_polygons.append({"points": np.array(points, np.int32), "zone": zone})

    entry_zone_points = scale_points(raw_entry_zone, scale_x, scale_y) if raw_entry_zone else None
    exit_zone_points = scale_points(raw_exit_zone, scale_x, scale_y) if raw_exit_zone else None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                # Loop playback for file-based sources
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue

            # Draw parking slot polygons with zone colors
            zone_colors = {
                "A": (0, 165, 255),   # Amber/Gold (BGR)
                "B": (219, 152, 52),  # Blue (BGR)
                "C": (182, 89, 155),  # Purple (BGR)
            }
            for slot in parking_polygons:
                poly = slot["points"]
                zone = slot["zone"]
                color = zone_colors.get(zone, (0, 255, 0))
                cv2.polylines(frame, [poly], isClosed=True, color=color, thickness=2)

            draw_flow_zone(frame, entry_zone_points, (16, 185, 129), "ENTRY")
            draw_flow_zone(frame, exit_zone_points, (94, 63, 244), "EXIT")

            ret, buffer = cv2.imencode('.jpg', frame)
            if not ret:
                continue
            frame_bytes = buffer.tobytes()

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
    finally:
        cap.release()


@app.post("/parking/override")
def parking_override(data: dict, db: Session = Depends(get_db)):
    """
    Manually override the status of a parking slot.
    Expects: { "slot_id": "...", "status": "available" | "occupied", ... }
    """
    slot_id = data.get("slot_id")
    status = data.get("status")

    if not slot_id or status not in {"available", "occupied"}:
        raise HTTPException(status_code=400, detail="Invalid slot_id or status")

    slot = update_slot_status(db, slot_id, status)
    return {"message": "Override applied", "slot": {"id": slot.id, "status": slot.status}}

@app.get("/parking/camera-status")
async def camera_status():
    """Check if the current video source is active and reading frames."""
    try:
        source = getattr(Config, "VIDEO_SOURCE", None)
        active_camera_id = _get_active_camera_id()
        cameras = _load_camera_sources()
        # Prefer background pipeline state (true "currently open and reading frames").
        if hasattr(app.state, "camera_open"):
            source = getattr(app.state, "camera_source", source)
            return {
                "active": bool(getattr(app.state, "camera_open", False) and getattr(app.state, "camera_last_read_ok", False)),
                "open": bool(getattr(app.state, "camera_open", False)),
                "source": _normalize_source_value(source),
                "mode": _source_mode(source),
                "active_camera_id": active_camera_id,
                "cameras": [_serialize_camera(camera, active_camera_id=active_camera_id, current_source=source) for camera in cameras],
            }

        if source is None or source == "":
            return {"active": False, "open": False, "source": None, "mode": "none", "active_camera_id": active_camera_id, "cameras": [_serialize_camera(camera, active_camera_id=active_camera_id) for camera in cameras]}

        # No pipeline state yet - just report what's configured
        return {"active": False, "open": False, "source": _normalize_source_value(source), "mode": _source_mode(source), "active_camera_id": active_camera_id, "cameras": [_serialize_camera(camera, active_camera_id=active_camera_id, current_source=source) for camera in cameras]}
    except Exception as e:
        print(f"Camera status error: {e}")
        source = getattr(Config, "VIDEO_SOURCE", None)
        return {"active": False, "open": False, "source": _normalize_source_value(source), "mode": _source_mode(source), "active_camera_id": _get_active_camera_id(), "cameras": [_serialize_camera(camera, active_camera_id=_get_active_camera_id(), current_source=source) for camera in _load_camera_sources()]}


@app.get("/parking/cameras")
def parking_cameras(_: User = Depends(_get_current_user)):
    source = getattr(app.state, "camera_source", getattr(Config, "VIDEO_SOURCE", None))
    active_camera_id = _get_active_camera_id()
    return {
        "active_camera_id": active_camera_id,
        "cameras": [_serialize_camera(camera, active_camera_id=active_camera_id, current_source=source) for camera in _load_camera_sources()],
    }


@app.post("/parking/cameras")
def parking_camera_create(
    data: dict,
    _: User = Depends(_require_roles("admin")),
):
    name = str(data.get("name") or "").strip()
    raw_source = data.get("source")
    source = _normalize_source_value(raw_source)
    if not name:
        raise HTTPException(status_code=400, detail="Camera name is required")
    if source is None or source == "":
        raise HTTPException(status_code=400, detail="Camera source is required")

    if not isinstance(source, int) and not _validate_source_file(source):
        raise HTTPException(status_code=400, detail="Camera source is invalid or not accessible")

    settings_data = _load_runtime_settings()
    cameras = settings_data.get("camera_sources") or []
    camera_id = _camera_slug(data.get("id") or name)
    existing_ids = {_camera_slug(item.get("id") or item.get("name") or "") for item in cameras if isinstance(item, dict)}
    while camera_id in existing_ids:
        camera_id = f"{camera_id}-{len(existing_ids) + 1}"

    slot_path = str(data.get("slots_path") or _camera_slots_path(camera_id)).strip()
    os.makedirs(os.path.dirname(slot_path), exist_ok=True)
    if not os.path.exists(slot_path):
        with open(slot_path, "w", encoding="utf-8") as handle:
            json.dump({"parking_areas": [], "frame_width": 1280, "frame_height": 720, "entry_zone": None, "exit_zone": None}, handle)

    next_camera = {
        "id": camera_id,
        "name": name,
        "source": raw_source,
        "slots_path": slot_path,
    }
    cameras.append(next_camera)
    settings_data["camera_sources"] = cameras
    _save_runtime_settings(settings_data)

    camera = _get_camera_by_id(camera_id)
    return {"camera": _serialize_camera(camera, active_camera_id=_get_active_camera_id())}


@app.delete("/parking/cameras/{camera_id}")
def parking_camera_delete(
    camera_id: str,
    _: User = Depends(_require_roles("admin")),
):
    settings_data = _load_runtime_settings()
    cameras = settings_data.get("camera_sources") or []
    remaining = []
    removed = None
    for item in cameras:
        if not isinstance(item, dict):
            continue
        item_id = _camera_slug(item.get("id") or item.get("name") or "")
        if item_id == camera_id:
            removed = item
            continue
        remaining.append(item)

    if removed is None:
        raise HTTPException(status_code=404, detail="Camera not found")

    settings_data["camera_sources"] = remaining
    _save_runtime_settings(settings_data)
    if getattr(app.state, "active_camera_id", None) == camera_id:
        app.state.active_camera_id = None
    return {"message": "Camera removed"}


@app.post("/parking/cameras/{camera_id}/activate")
def parking_camera_activate(
    camera_id: str,
    _: User = Depends(_get_current_user),
):
    camera = _get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    source = _normalize_source_value(camera.get("source"))
    if source is None or source == "":
        raise HTTPException(status_code=400, detail="Camera source is not configured")
    if not isinstance(source, int) and not _validate_source_file(source):
        raise HTTPException(status_code=400, detail="Camera source is invalid or not accessible")

    Config.VIDEO_SOURCE = source
    app.state.active_camera_id = camera["id"]
    return {
        "message": "Camera activated",
        "active_camera_id": camera["id"],
        "source": source,
        "mode": _source_mode(source),
    }


@app.get("/public/access-portal")
def public_access_portal(db: Session = Depends(get_db)):
    config = _access_portal_config()
    payment_config = _admin_qr_payment_config()
    camera_active = bool(getattr(app.state, "camera_open", False) and getattr(app.state, "camera_last_read_ok", False))
    source = getattr(app.state, "camera_source", getattr(Config, "VIDEO_SOURCE", None))
    active_camera_id = _get_active_camera_id()
    cameras = _load_camera_sources()

    total_slots = 0
    try:
        slots_path = _get_slots_path_for_current_source()
        if os.path.exists(slots_path):
            with open(slots_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            total_slots = len(data.get("parking_areas", []) or [])
    except Exception:
        total_slots = 0

    live_stats = get_parking_stats(db)
    unresolved_alerts = db.query(Alert).filter(Alert.resolved.is_(False)).count()
    recent_sessions = db.query(ParkingSession).order_by(ParkingSession.entry_time.desc()).limit(3).all()

    return {
        "title": config["title"],
        "tagline": config["tagline"],
        "public_url": config["public_url"],
        "stats": {
            "total_slots": int(live_stats.get("total") or total_slots or 0),
            "available": int(live_stats.get("available") or 0),
            "occupied": int(live_stats.get("occupied") or 0),
            "reserved": int(live_stats.get("reserved") or 0),
            "occupancy_rate": float(live_stats.get("occupancy_rate") or 0),
            "active_alerts": unresolved_alerts,
        },
        "camera": {
            "active": camera_active,
            "source_mode": _source_mode(source),
            "active_camera_id": active_camera_id,
            "cameras": [_serialize_camera(camera, active_camera_id=active_camera_id, current_source=source) for camera in cameras],
        },
        "payments": {
            "enabled": payment_config["enabled"],
            "method": payment_config["method"],
            "receiver_name": payment_config["receiver_name"],
            "qr_code": payment_config["qr_code"],
            "instructions": payment_config["instructions"],
        },
        "zone_pricing": config.get("zone_pricing", {}),
        "zone_duration": config.get("zone_duration", {}),
        "features": [
            {
                "id": "reservations",
                "title": "Smart Reservations",
                "description": "Reserve a slot in real time with smart assignment and an instant confirmation code.",
            },
            {
                "id": "live_status",
                "title": "Live Availability",
                "description": "See which zones and slots are available, reserved, or occupied before booking.",
            },
            {
                "id": "payments",
                "title": "Alipay QR Payment",
                "description": "Open the QR instantly after booking and complete payment from the same portal.",
            },
            {
                "id": "tracking",
                "title": "Booking Tracking",
                "description": "Find your reservation anytime using the confirmation code or your license plate.",
            },
            {
                "id": "checkout",
                "title": "Quick Checkout",
                "description": "Release your slot early when you leave so the system can make it available again.",
            },
            {
                "id": "smart_flow",
                "title": "Smart Time Window",
                "description": "Reservations stay active for 15 minutes, then expire automatically if unused.",
            },
        ],
        "recent_sessions": [
            {
                "slot_id": session.slot_id,
                "entry_time": session.entry_time.isoformat() + "Z" if session.entry_time else None,
                "exit_time": session.exit_time.isoformat() + "Z" if session.exit_time else None,
                "duration_minutes": session.duration_minutes,
            }
            for session in recent_sessions
        ],
    }


@app.get("/public/qr-code")
def public_qr_code(data: str, size: int = 240):
    payload = (data or "").strip()
    if not payload:
        raise HTTPException(status_code=400, detail="QR data is required")

    bounded_size = min(max(int(size or 240), 64), 1024)
    drawing = createBarcodeDrawing("QR", value=payload, width=bounded_size, height=bounded_size)
    svg = renderSVG.drawToString(drawing)
    if isinstance(svg, str):
        svg = svg.encode("utf-8")
    return Response(content=svg, media_type="image/svg+xml")

@app.post("/parking/set-source")
async def set_source(data: dict):
    """Set the video source at runtime (e.g., to webcam or file path)."""
    source = _normalize_source_value(data.get('source'))
    if source is None or source == "":
        Config.VIDEO_SOURCE = None
        app.state.active_camera_id = None
        return {"message": "Source cleared", "mode": "none", "source": None}

    try:
        if isinstance(source, int):
            # Don't try to open the webcam here - the background process_video
            # loop handles that. Just validate the config and set the source.
            # This avoids webcam contention when the background loop already holds it.
            valid = True
        else:
            valid = isinstance(source, str) and _validate_source_file(source)

        if not valid:
            raise HTTPException(status_code=400, detail="Source is invalid or not accessible")

        Config.VIDEO_SOURCE = source
        app.state.active_camera_id = data.get("camera_id") or None
        return {"message": "Source updated successfully", "mode": _source_mode(source), "source": source}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"Set source error: {e}")
        raise HTTPException(status_code=500, detail="Source validation failed")


@app.get("/parking/sessions")
async def get_sessions(limit: int = 50, db: Session = Depends(get_db)):
    """
    Get recent parking sessions (slot occupancy durations).
    """
    try:
        sessions = (
            db.query(ParkingSession)
            .order_by(ParkingSession.entry_time.desc())
            .limit(limit)
            .all()
        )
        return {
            "sessions": [
                {
                    "slot_id": s.slot_id,
                    "entry_time": (s.entry_time.isoformat() + "Z") if s.entry_time else None,
                    "exit_time": (s.exit_time.isoformat() + "Z") if s.exit_time else None,
                    "duration_minutes": s.duration_minutes,
                }
                for s in sessions
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load sessions: {e}")

from pydantic import BaseModel

class DetectRequest(BaseModel):
    image: str

@app.post("/detect-frame")
async def detect_frame(request: DetectRequest):
    """Detect vehicles in a base64 encoded image and return image with bounding boxes."""
    image_data = base64.b64decode(request.image)
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    model = getattr(app.state, "model", None)
    if model is None:
        raise HTTPException(status_code=500, detail="YOLO model is not loaded")

    results = model(np.array(image), conf=0.3, verbose=False)
    detections = []
    if results and len(results) > 0:
        for box in results[0].boxes:
            try:
                if int(box.cls[0]) not in [2, 5, 7]:
                    continue
                x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
                detections.append({"bbox": [x1, y1, x2, y2], "class": int(box.cls[0])})
            except Exception:
                continue
    
    # Draw bounding boxes
    img_array = np.array(image)
    for det in detections:
        bbox = det['bbox']
        x1, y1, x2, y2 = map(int, bbox)
        cv2.rectangle(img_array, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(img_array, str(det.get('class', 'car')), (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    
    _, encoded_img = cv2.imencode('.jpg', cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR))
    img_base64 = base64.b64encode(encoded_img.tobytes()).decode('utf-8')
    return {"image": img_base64}

def _get_slots_path_for_current_source():
    """
    Decide which slots JSON to use based on the active video source.
    Named cameras get their own layout; generic webcams keep the webcam layout;
    everything else uses the default file.
    """
    active_camera = _get_camera_by_id(_get_active_camera_id())
    if active_camera and active_camera.get("slots_path"):
        return active_camera["slots_path"]

    src = _normalize_source_value(getattr(app.state, "camera_source", getattr(Config, "VIDEO_SOURCE", None)))
    if isinstance(src, int) or (isinstance(src, str) and src.startswith("/dev/video")):
        return Config.PARKING_SLOTS_JSON_WEBCAM
    return Config.PARKING_SLOTS_JSON


@app.post("/update-parking-slots")
async def update_parking_slots(data: dict):
    """
    Update the parking slots configuration.
    Accepts both new format (list of {points, zone}) and legacy format (list of points).
    """
    parking_slots = data.get('parking_slots', [])
    entry_zone = data.get('entry_zone')
    exit_zone = data.get('exit_zone')

    # Normalize: convert to new format {points: [...], zone: "A"}
    normalized_slots = []
    for slot in parking_slots:
        if isinstance(slot, dict) and 'points' in slot:
            normalized_slots.append({
                "points": slot["points"],
                "zone": slot.get("zone", "A")
            })
        elif isinstance(slot, list):
            # Legacy flat array format
            normalized_slots.append({"points": slot, "zone": "A"})

    json_data = {"parking_areas": normalized_slots}
    if 'frame_width' in data:
        json_data['frame_width'] = data['frame_width']
        json_data['frame_height'] = data['frame_height']

    # Optional global entry/exit zones for revenue/flow analytics
    if entry_zone is not None:
        json_data['entry_zone'] = entry_zone
    if exit_zone is not None:
        json_data['exit_zone'] = exit_zone
    
    slots_path = _get_slots_path_for_current_source()
    os.makedirs(os.path.dirname(slots_path), exist_ok=True)
    with open(slots_path, 'w') as f:
        json.dump(json_data, f)
    
    return {"message": "Parking slots updated successfully. Changes applied directly."}


@app.post("/parking/slots")
async def save_slots(data: dict):
    """
    Alias endpoint for saving parking slots configuration.
    Frontend Slot Editor can POST here.
    """
    return await update_parking_slots(data)

@app.get("/parking/status")
def get_parking_status(db: Session = Depends(get_db)):
    """
    Get current status of all parking slots.
    """
    slots = get_all_slots(db)
    status = {slot.id: slot.status for slot in slots}
    return {"status": status}

@app.get("/parking/slots")
def get_parking_slots():
    """Get the current parking slot polygons with zone types and optional entry/exit zones."""
    try:
        slots_path = _get_slots_path_for_current_source()
        if not os.path.exists(slots_path):
            return {"polygons": [], "entry_zone": None, "exit_zone": None, "frame_width": None, "frame_height": None}
        with open(slots_path, 'r') as f:
            data = json.load(f)
        raw_areas = data.get("parking_areas", [])
        # Normalize: convert legacy flat arrays to {points, zone} format
        polygons = []
        for area in raw_areas:
            if isinstance(area, dict) and 'points' in area:
                polygons.append({"points": area["points"], "zone": area.get("zone", "A")})
            elif isinstance(area, list):
                polygons.append({"points": area, "zone": "A"})
        return {
            "polygons": polygons,
            "entry_zone": data.get("entry_zone"),
            "exit_zone": data.get("exit_zone"),
            "frame_width": data.get("frame_width"),
            "frame_height": data.get("frame_height"),
        }
    except:
        return {"polygons": [], "entry_zone": None, "exit_zone": None, "frame_width": None, "frame_height": None}

@app.get("/parking/stats")
def get_parking_stats(db: Session = Depends(get_db)):
    """
    Get parking statistics.
    Total reflects slots defined in SlotEditor (parking_slots.json).
    Returns all zeros when camera/video is not active.
    """
    # Check if camera is active
    camera_active = bool(getattr(app.state, "camera_open", False) and getattr(app.state, "camera_last_read_ok", False))

    # Get total from saved slots JSON (SlotEditor)
    total_from_json = 0
    try:
        slots_path = _get_slots_path_for_current_source()
        if os.path.exists(slots_path):
            with open(slots_path, 'r') as f:
                data = json.load(f)
            raw_areas = data.get("parking_areas", [])
            total_from_json = len(raw_areas)
    except Exception:
        pass

    # If camera not active, return zeros
    if not camera_active:
        return {
            "total": 0,
            "available": 0,
            "occupied": 0,
            "occupancy_rate": 0,
        }

    # Get live occupancy from DB
    slots = get_all_slots(db)
    status = {slot.id: slot.status for slot in slots}
    stats = get_parking_statistics(status)
    reserved_slot_ids = _active_reserved_slot_ids(db)
    reserved_free_count = len([slot_id for slot_id in reserved_slot_ids if status.get(slot_id) != "occupied"])

    # Override total with saved slot count from SlotEditor
    stats["total"] = total_from_json
    # Recompute occupancy rate based on correct total
    occupied = stats.get("occupied", 0)
    available = max(0, total_from_json - occupied - reserved_free_count)
    stats["available"] = available
    stats["reserved"] = reserved_free_count
    stats["occupancy_rate"] = round(((occupied + reserved_free_count) / total_from_json) * 100, 2) if total_from_json > 0 else 0
    return stats

@app.get("/parking/history")
def get_parking_history(limit: int = 50, db: Session = Depends(get_db)):
    """
    Get parking history logs.
    """
    query = db.query(ParkingHistory).order_by(ParkingHistory.timestamp.desc())
    logs = query.limit(limit).all()
    result = [
        {
            "id": log.id,
            "slot_id": log.slot_id,
            "timestamp": (log.timestamp.isoformat() + "Z") if log.timestamp else None,
            "status": log.status,
            "entry_time": (log.timestamp.isoformat() + "Z") if log.status == "occupied" and log.timestamp else None,
            "exit_time": (log.timestamp.isoformat() + "Z") if log.status == "available" and log.timestamp else None,
            "duration_minutes": log.dwell_minutes,
            "vehicle_type": log.vehicle_type,
            "plate": log.plate,
            "speed_kmh": log.speed_kmh,
        } for log in logs
    ]
    return {"history": result}

@app.get("/lpr/history")
def get_lpr_history(limit: int = 50, plate: str = None, db: Session = Depends(get_db)):
    """
    Get LPR logs, optionally filtered by plate.
    """
    query = db.query(PlateLog).order_by(PlateLog.timestamp.desc())
    if plate:
        query = query.filter(PlateLog.plate == plate)
    logs = query.limit(limit).all()
    result = [
        {
            "id": log.id,
            "plate": log.plate,
            "slot_id": log.slot_id,
            "event_type": log.event_type,
            "timestamp": log.timestamp.isoformat() + "Z" if log.timestamp else None,
            "confidence": log.confidence,
            "vehicle_type": log.vehicle_type
        } for log in logs
    ]
    return {"logs": result}

@app.get("/revenue/summary")
def get_revenue_summary(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    today_total = db.query(Transaction).filter(Transaction.entry_time >= today_start).with_entities(Transaction.amount).all()
    week_total = db.query(Transaction).filter(Transaction.entry_time >= week_start).with_entities(Transaction.amount).all()
    month_total = db.query(Transaction).filter(Transaction.entry_time >= month_start).with_entities(Transaction.amount).all()
    total_amount = db.query(Transaction.amount).all()
    total_vehicles = len(total_amount)
    avg_per_vehicle = sum(a[0] for a in total_amount) / total_vehicles if total_vehicles > 0 else 0

    return {
        "today": round(sum(a[0] for a in today_total), 2),
        "week": round(sum(a[0] for a in week_total), 2),
        "month": round(sum(a[0] for a in month_total), 2),
        "avg_per_vehicle": round(avg_per_vehicle, 2)
    }

@app.get("/revenue/transactions")
def get_revenue_transactions(limit: int = 20, page: int = 1, date: str = None, db: Session = Depends(get_db)):
    query = db.query(Transaction).order_by(Transaction.entry_time.desc())
    if date:
        date_obj = datetime.fromisoformat(date)
        query = query.filter(Transaction.entry_time >= date_obj, Transaction.entry_time < date_obj + timedelta(days=1))
    total = query.count()
    transactions = query.offset((page - 1) * limit).limit(limit).all()
    result = [
        {
            "time": t.entry_time.isoformat() + "Z" if t.entry_time else None,
            "plate": t.plate,
            "slot": t.slot_id,
            "type": t.vehicle_type,
            "duration": _format_duration_minutes(t.duration_mins, t.entry_time, t.exit_time),
            "duration_minutes": _derive_duration_minutes(t.duration_mins, t.entry_time, t.exit_time),
            "amount": t.amount,
            "status": t.status
        } for t in transactions
    ]
    return {"transactions": result, "total": total, "page": page, "limit": limit}

@app.get("/revenue/chart")
def get_revenue_chart(range: str = "7d", db: Session = Depends(get_db)):
    days = 7 if range == "7d" else 30
    start_date = datetime.utcnow() - timedelta(days=days)
    from sqlalchemy import func
    daily_totals = db.query(
        func.date(Transaction.entry_time).label('date'),
        func.sum(Transaction.amount).label('total')
    ).filter(Transaction.entry_time >= start_date).group_by(func.date(Transaction.entry_time)).all()
    result = [{"date": str(d[0]), "total": float(d[1])} for d in daily_totals]
    return {"data": result}

@app.get("/analytics/dwell")
def get_dwell_summary(db: Session = Depends(get_db)):
    dwells = db.query(ParkingSession.duration_minutes).filter(ParkingSession.duration_minutes.isnot(None)).all()
    if not dwells:
        return {"avg_dwell": 0, "median_dwell": 0, "max_dwell": 0, "most_common": 0}
    values = [d[0] for d in dwells]
    avg = sum(values) / len(values)
    median = sorted(values)[len(values) // 2]
    max_dwell = max(values)
    most_common = max(set(values), key=values.count)
    return {
        "avg_dwell": round(avg, 2),
        "median_dwell": round(median, 2),
        "max_dwell": round(max_dwell, 2),
        "most_common": round(most_common, 2)
    }

@app.get("/analytics/dwell/chart")
def get_dwell_chart(zone: str = None, range: str = "7d", db: Session = Depends(get_db)):
    days = 7 if range == "7d" else 30
    start_date = datetime.utcnow() - timedelta(days=days)
    from sqlalchemy import func
    session_time = func.coalesce(ParkingSession.exit_time, ParkingSession.entry_time)
    query = db.query(
        func.extract('hour', session_time).label('hour'),
        func.avg(ParkingSession.duration_minutes).label('avg_dwell')
    ).filter(ParkingSession.duration_minutes.isnot(None), session_time >= start_date)
    if zone:
        query = query.filter(ParkingSession.slot_id.like(f"{zone}%"))
    hourly_avgs = query.group_by(func.extract('hour', session_time)).all()
    result = [{"hour": int(h[0]), "avg_dwell": float(h[1])} for h in hourly_avgs]
    return {"data": result}

@app.get("/analytics/occupancy-history")
def get_occupancy_history(limit: int = 100, db: Session = Depends(get_db)):
    """
    Get occupancy history for charting.
    """
    history = db.query(OccupancyHistory).order_by(OccupancyHistory.timestamp.desc()).limit(limit).all()
    result = [{"time": h.timestamp.isoformat() + "Z", "occupancy": h.occupancy_rate} for h in history]
    return {"data": result[::-1]}


@app.get("/parking/occupancy-history")
async def get_parking_occupancy_history(limit: int = 120, db: Session = Depends(get_db)):
    """
    Occupancy history for dashboard charting (roughly last 1 hour at 30s cadence).
    """
    history = (
        db.query(OccupancyHistory)
        .order_by(OccupancyHistory.timestamp.desc())
        .limit(limit)
        .all()
    )
    return {"data": [{"time": h.timestamp.isoformat() + "Z", "occupancy": h.occupancy_rate} for h in history][::-1]}


@app.get("/analytics/heatmap")
def get_analytics_heatmap(range: str = "30d", db: Session = Depends(get_db)):
    """
    Return an occupancy heatmap per zone per hour.
    Currently uses a placeholder implementation in heatmap.py.
    """
    days = 7 if range == "7d" else 30
    matrix = get_heatmap(range_days=days)
    return {"matrix": matrix}

@app.post("/export/trigger")
def trigger_export(db: Session = Depends(get_db)):
    try:
        from .scheduler import export_daily_report
    except ImportError:
        from scheduler import export_daily_report
    result = export_daily_report()
    return result

@app.get("/export/download")
def download_export(db: Session = Depends(get_db)):
    """Generate and download the current CSV report."""
    try:
        from .reporting import build_csv_report, collect_report_data
    except ImportError:
        from reporting import build_csv_report, collect_report_data

    report = collect_report_data(db)
    content = build_csv_report(report)
    filename = f'report_{report["date_str"]}.csv'
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/export/history")
def get_export_history(db: Session = Depends(get_db)):
    history = db.query(ExportHistory).order_by(ExportHistory.timestamp.desc()).all()
    result = [
        {
            "filename": h.filename,
            "file_size": h.file_size,
            "destination": h.destination,
            "timestamp": h.timestamp.isoformat() + "Z" if h.timestamp else None
        } for h in history
    ]
    return {"history": result}


@app.get("/export/report/pdf")
def export_report_pdf(db: Session = Depends(get_db)):
    try:
        from .reporting import build_pdf_report, collect_report_data
    except ImportError:
        from reporting import build_pdf_report, collect_report_data

    data = collect_report_data(db)
    content = build_pdf_report(data)
    date_str = data["date_str"]
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=SmartParking_Report_{date_str}.pdf"}
    )


@app.get("/export/report/excel")
def export_report_excel(db: Session = Depends(get_db)):
    try:
        from .reporting import build_excel_report, collect_report_data
    except ImportError:
        from reporting import build_excel_report, collect_report_data

    data = collect_report_data(db)
    content = build_excel_report(data)
    date_str = data["date_str"]
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=SmartParking_Report_{date_str}.xlsx"}
    )


@app.post("/export/report/email")
def export_report_email(db: Session = Depends(get_db)):
    """Generate report and send via email."""
    try:
        from .scheduler import export_daily_report
    except ImportError:
        from scheduler import export_daily_report
    result = export_daily_report()
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return {"message": "Report generated and emailed", "filename": result.get("filename", "")}


@app.get("/alerts")
def get_alerts(limit: int = 50, resolved: bool = None, db: Session = Depends(get_db)):
    """Get alerts, optionally filtered by resolved status."""
    query = db.query(Alert).order_by(Alert.timestamp.desc())
    if resolved is not None:
        query = query.filter(Alert.resolved == resolved)
    alerts = query.limit(limit).all()
    return {
        "alerts": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "slot_id": a.slot_id,
                "vehicle_id": a.vehicle_id,
                "detail": a.detail,
                "resolved": a.resolved,
                "timestamp": a.timestamp.isoformat() + "Z" if a.timestamp else None,
            }
            for a in alerts
        ]
    }

@app.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    """Mark an alert as resolved."""
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.resolved = True
    db.commit()
    return {"message": "Alert resolved"}

@app.get("/settings")
def get_settings(_: User = Depends(_require_roles("admin"))):
    return _load_runtime_settings()

@app.put("/settings")
def update_settings(data: dict, _: User = Depends(_require_roles("admin"))):
    merged_settings = {**_load_runtime_settings(), **(data or {})}
    _save_runtime_settings(merged_settings)
    return {"message": "Settings updated", "settings": merged_settings}
