from sqlalchemy import create_engine, String, Integer, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from datetime import datetime
import json
import os
from .config import Config

class Base(DeclarativeBase):
    pass

engine = create_engine(Config.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class ParkingSlot(Base):
    __tablename__ = "parking_slots"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    status: Mapped[str] = mapped_column(String, default="available")  # "occupied" or "available"
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ParkingHistory(Base):
    __tablename__ = "parking_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    slot_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

def create_tables():
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

def update_slot_status(db, slot_id, status):
    slot = db.query(ParkingSlot).filter(ParkingSlot.id == slot_id).first()
    if slot:
        slot.status = status
        slot.updated_at = datetime.utcnow()
        # Insert history
        history = ParkingHistory(slot_id=slot_id, status=status)
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
