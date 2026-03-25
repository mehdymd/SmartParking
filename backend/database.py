from sqlalchemy import create_engine, String, Integer, DateTime, Float, Text, Boolean
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from datetime import datetime
import json
import os
try:
    from .config import Config
except ImportError:
    from config import Config

class Base(DeclarativeBase):
    pass


def _sqlite_fallback_url():
    db_path = os.path.join(os.path.dirname(__file__), "parking_local.db")
    return f"sqlite:///{db_path}"


def _build_engine(url):
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        kwargs["connect_args"] = {"connect_timeout": 5}
    return create_engine(url, **kwargs)


engine = _build_engine(Config.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
ACTIVE_DATABASE_URL = Config.DATABASE_URL

class ParkingSlot(Base):
    __tablename__ = "parking_slots"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    status: Mapped[str] = mapped_column(String, default="available")  # "occupied" or "available"
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ParkingHistory(Base):
    __tablename__ = "parking_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    slot_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    vehicle_type: Mapped[str] = mapped_column(String, nullable=True)
    plate: Mapped[str] = mapped_column(String, nullable=True)
    dwell_minutes: Mapped[int] = mapped_column(Integer, nullable=True)
    speed_kmh: Mapped[float] = mapped_column(Float, nullable=True)

class PlateLog(Base):
    __tablename__ = "plate_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    plate: Mapped[str] = mapped_column(String, nullable=False)
    slot_id: Mapped[str] = mapped_column(String, nullable=True)
    event_type: Mapped[str] = mapped_column(String)  # 'entry' or 'exit'
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    confidence: Mapped[float] = mapped_column(Float, nullable=True)
    vehicle_type: Mapped[str] = mapped_column(String, nullable=True)

class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    alert_type: Mapped[str] = mapped_column(String)  # 'abandoned','wrong_way','speed','type_mismatch'
    slot_id: Mapped[str] = mapped_column(String, nullable=True)
    vehicle_id: Mapped[str] = mapped_column(String, nullable=True)
    detail: Mapped[str] = mapped_column(Text, nullable=True)  # JSON string
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    plate: Mapped[str] = mapped_column(String, nullable=True)
    vehicle_type: Mapped[str] = mapped_column(String, nullable=True)
    slot_id: Mapped[str] = mapped_column(String, nullable=True)
    entry_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    exit_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    duration_mins: Mapped[int] = mapped_column(Integer, nullable=True)
    amount: Mapped[float] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String, default='USD')
    status: Mapped[str] = mapped_column(String, default='completed')

class OccupancyHistory(Base):
    __tablename__ = "occupancy_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    occupancy_rate: Mapped[float] = mapped_column(Float, nullable=True)

class ExportHistory(Base):
    __tablename__ = "export_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String, nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, nullable=True)
    destination: Mapped[str] = mapped_column(String, nullable=True)  # 'local','email','s3'
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ParkingSession(Base):
    __tablename__ = "parking_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    slot_id: Mapped[str] = mapped_column(String, index=True)
    entry_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    exit_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=True)


def _switch_database(url):
    global engine, ACTIVE_DATABASE_URL
    engine = _build_engine(url)
    SessionLocal.configure(bind=engine)
    ACTIVE_DATABASE_URL = url


def create_tables():
    global ACTIVE_DATABASE_URL
    try:
        Base.metadata.create_all(bind=engine)
    except OperationalError as exc:
        fallback_url = _sqlite_fallback_url()
        print(f"Database connection failed for {ACTIVE_DATABASE_URL}: {exc}")
        print(f"Falling back to local SQLite database at {fallback_url}")
        _switch_database(fallback_url)
        Base.metadata.create_all(bind=engine)

def load_parking_slots_from_json():
    with open(Config.PARKING_SLOTS_JSON, 'r') as f:
        slots = json.load(f)
    return {slot['id']: slot['bbox'] for slot in slots}

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_all_slots(db):
    return db.query(ParkingSlot).all()

def update_slot_status(db, slot_id, status, dwell_minutes=None):
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == slot_id).first()
    if slot:
        slot.status = status
    else:
        slot = ParkingSlot(id=slot_id, status=status)
        db.add(slot)
    slot.updated_at = datetime.utcnow()
    db.commit()
    history = ParkingHistory(slot_id=slot_id, status=status, dwell_minutes=dwell_minutes)
    db.add(history)
    db.commit()
    db.refresh(slot)
    return slot

def initialize_slots(db, slots_dict):
    for slot_id in slots_dict.keys():
        if not db.query(ParkingSlot).filter(ParkingSlot.id == slot_id).first():
            slot = ParkingSlot(id=slot_id, status="available")
            db.add(slot)
    db.commit()
