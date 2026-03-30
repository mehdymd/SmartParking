import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional
from fastapi import Header


def _secret_key() -> bytes:
    return (os.getenv("SECRET_KEY") or "smartparking-dev-secret-change-me").encode("utf-8")


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, digest_hex = stored_hash.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return hmac.compare_digest(actual, expected)


def create_access_token(subject: str, role: str, expires_hours: int = 12) -> str:
    payload = {
        "sub": subject,
        "role": role,
        "exp": int((datetime.utcnow() + timedelta(hours=expires_hours)).timestamp()),
    }
    encoded_payload = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_secret_key(), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded_payload}.{_b64url_encode(signature)}"


def decode_access_token(token: str):
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        expected_signature = hmac.new(_secret_key(), encoded_payload.encode("ascii"), hashlib.sha256).digest()
        actual_signature = _b64url_decode(encoded_signature)
        if not hmac.compare_digest(actual_signature, expected_signature):
            return None

        payload = json.loads(_b64url_decode(encoded_payload).decode("utf-8"))
        exp = int(payload.get("exp", 0))
        if exp < int(datetime.utcnow().timestamp()):
            return None
        return payload
    except Exception:
        return None


def generate_confirmation_code() -> str:
    return f"RES-{secrets.token_hex(3).upper()}"


def generate_otp(length: int = 6) -> str:
    return "".join([str(secrets.randbelow(10)) for _ in range(length)])


def hash_otp(otp: str) -> str:
    salt = secrets.token_bytes(8)
    digest = hashlib.pbkdf2_hmac("sha256", otp.encode("utf-8"), salt, 10000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_otp(otp: str, stored_hash: str) -> bool:
    # Debug: For testing, compare OTP directly (remove in production)
    try:
        # First try the proper hash verification
        salt_hex, digest_hex = stored_hash.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except Exception:
        # If hash format is invalid, return False
        return False

    actual = hashlib.pbkdf2_hmac("sha256", otp.encode("utf-8"), salt, 10000)
    return hmac.compare_digest(actual, expected)


def get_current_active_user_optional(authorization: str = None, db=None):
    """Optional authentication - returns None if no valid token, otherwise returns User or dict"""
    if not authorization:
        return None
    
    if authorization.startswith("Bearer "):
        token = authorization[7:]
    else:
        token = authorization
    
    payload = decode_access_token(token)
    if not payload:
        return None
    
    if db is None:
        from database import SessionLocal
        db = SessionLocal()
        close_db = True
    else:
        close_db = False
    
    try:
        from database import User
        username = payload.get("sub")
        user = db.query(User).filter(User.username == username).first()
        return user
    finally:
        if close_db:
            db.close()
