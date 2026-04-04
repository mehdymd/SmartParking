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


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    phone: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=True)
    full_name: Mapped[str] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(String, default="user")
    password_hash: Mapped[str] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String, default="medium")
    status: Mapped[str] = mapped_column(String, default="open")
    reported_by: Mapped[int] = mapped_column(Integer, nullable=True)
    assigned_to: Mapped[int] = mapped_column(Integer, nullable=True)
    resolved_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CashPayment(Base):
    __tablename__ = "cash_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    reservation_id: Mapped[int] = mapped_column(Integer, nullable=True)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String, default="USD")
    received_by: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, default="completed")
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PhoneOTP(Base):
    __tablename__ = "phone_otps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    phone: Mapped[str] = mapped_column(String, index=True)
    otp_hash: Mapped[str] = mapped_column(String)
    purpose: Mapped[str] = mapped_column(String, default="login")
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ParkingLot(Base):
    __tablename__ = "parking_lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    address: Mapped[str] = mapped_column(Text, nullable=True)
    total_slots: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

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


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    confirmation_code: Mapped[str] = mapped_column(String, unique=True, index=True)
    lot_name: Mapped[str] = mapped_column(String, default="Main Lot")
    slot_id: Mapped[str] = mapped_column(String, nullable=True, index=True)
    zone: Mapped[str] = mapped_column(String, nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, nullable=True)
    phone: Mapped[str] = mapped_column(String, nullable=True)
    license_plate: Mapped[str] = mapped_column(String, nullable=True, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    entry_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    actual_exit_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    overstay_minutes: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="confirmed", index=True)
    payment_status: Mapped[str] = mapped_column(String, default="pending")
    payment_method: Mapped[str] = mapped_column(String, nullable=True)
    payment_provider: Mapped[str] = mapped_column(String, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PaymentCustomer(Base):
    __tablename__ = "payment_customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    email: Mapped[str] = mapped_column(String, nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String, nullable=True)
    stripe_customer_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PaymentRecord(Base):
    __tablename__ = "payment_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    reservation_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    monthly_pass_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String, default="usd")
    payment_type: Mapped[str] = mapped_column(String, default="reservation")
    payment_method: Mapped[str] = mapped_column(String, nullable=True)
    payment_provider: Mapped[str] = mapped_column(String, default="stripe")
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    stripe_checkout_session_id: Mapped[str] = mapped_column(String, nullable=True, unique=True, index=True)
    stripe_payment_intent_id: Mapped[str] = mapped_column(String, nullable=True, index=True)
    stripe_invoice_id: Mapped[str] = mapped_column(String, nullable=True, index=True)
    stripe_customer_id: Mapped[str] = mapped_column(String, nullable=True, index=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MonthlyPass(Base):
    __tablename__ = "monthly_passes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, nullable=True, index=True)
    phone: Mapped[str] = mapped_column(String, nullable=True)
    license_plate: Mapped[str] = mapped_column(String, nullable=True, index=True)
    lot_name: Mapped[str] = mapped_column(String, default="Main Lot")
    zone: Mapped[str] = mapped_column(String, default="A", index=True)
    plan_name: Mapped[str] = mapped_column(String, default="Monthly Pass")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String, default="usd")
    interval: Mapped[str] = mapped_column(String, default="month")
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    stripe_customer_id: Mapped[str] = mapped_column(String, nullable=True, index=True)
    stripe_checkout_session_id: Mapped[str] = mapped_column(String, nullable=True, unique=True, index=True)
    stripe_subscription_id: Mapped[str] = mapped_column(String, nullable=True, unique=True, index=True)
    current_period_start: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    current_period_end: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WaitlistEntry(Base):
    __tablename__ = "waitlist_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    lot_name: Mapped[str] = mapped_column(String, default="Main Lot", index=True)
    zone: Mapped[str] = mapped_column(String, nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, nullable=True, index=True)
    phone: Mapped[str] = mapped_column(String, nullable=True)
    license_plate: Mapped[str] = mapped_column(String, nullable=True, index=True)
    user_type: Mapped[str] = mapped_column(String, default="visitor", index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String, default="waiting", index=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    promoted_reservation_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class IncidentReport(Base):
    __tablename__ = "incident_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    lot_name: Mapped[str] = mapped_column(String, default="Main Lot", index=True)
    slot_id: Mapped[str] = mapped_column(String, nullable=True, index=True)
    severity: Mapped[str] = mapped_column(String, default="medium", index=True)
    category: Mapped[str] = mapped_column(String, default="general", index=True)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    image_path: Mapped[str] = mapped_column(Text, nullable=True)
    reporter_name: Mapped[str] = mapped_column(String, nullable=True)
    reported_by_user_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    token_hash: Mapped[str] = mapped_column(Text, unique=True, index=True)
    role: Mapped[str] = mapped_column(String, default="integration")
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=60)
    last_used_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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


def ensure_default_admin():
    try:
        from .security import hash_password
    except ImportError:
        from security import hash_password

    db = SessionLocal()
    try:
        existing = db.query(User).count()
        if existing:
            return

        username = os.getenv("ADMIN_USERNAME", "admin").strip() or "admin"
        password = os.getenv("ADMIN_PASSWORD", "admin123")
        full_name = os.getenv("ADMIN_FULL_NAME", "System Administrator").strip() or "System Administrator"
        user = User(
            username=username,
            full_name=full_name,
            role="admin",
            password_hash=hash_password(password),
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Startup: created default admin user '{username}'")
    finally:
        db.close()


def ensure_default_lot():
    db = SessionLocal()
    try:
        if db.query(ParkingLot).count():
            return
        lot = ParkingLot(code="main", name="Main Lot", address="", total_slots=0, is_active=True)
        db.add(lot)
        db.commit()
        print("Startup: created default parking lot 'Main Lot'")
    finally:
        db.close()

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
