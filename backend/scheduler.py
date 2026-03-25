import os
from email.mime.application import MIMEApplication

# Optional dependencies - guard imports
try:
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    EMAIL_AVAILABLE = True
except ImportError:
    EMAIL_AVAILABLE = False

try:
    import boto3
    S3_AVAILABLE = True
except ImportError:
    S3_AVAILABLE = False

EXPORT_DIR = os.path.join(os.path.dirname(__file__), "../exports")
SETTINGS_PATH = os.path.join(os.path.dirname(__file__), "settings.json")
os.makedirs(EXPORT_DIR, exist_ok=True)


def export_daily_report():
    """
    Export organized daily reports to CSV, PDF, and Excel.
    Logs the export to the ExportHistory table.
    """
    try:
        from .database import ExportHistory, SessionLocal
        from .reporting import collect_report_data, save_report_files
    except ImportError:
        from database import ExportHistory, SessionLocal
        from reporting import collect_report_data, save_report_files

    db = SessionLocal()
    try:
        report = collect_report_data(db)
        files = save_report_files(report, EXPORT_DIR)
        csv_file = files["csv"]
        file_size = sum(item["size"] for item in files.values())

        # Log export
        export_record = ExportHistory(
            filename=csv_file["filename"],
            file_size=file_size,
            destination="local"
        )
        db.add(export_record)
        db.commit()

        print(f"Exported daily reports: {', '.join(item['filename'] for item in files.values())}")

        # Optional: email
        try:
            _load_settings_and_email(files, report)
        except Exception as e:
            print(f"Email export skipped: {e}")

        # Optional: S3
        try:
            _load_settings_and_s3(files["xlsx"]["path"], files["xlsx"]["filename"])
        except Exception as e:
            print(f"S3 export skipped: {e}")

        return {
            "filename": csv_file["filename"],
            "file_size": file_size,
            "path": csv_file["path"],
            "files": files,
        }

    except Exception as e:
        print(f"Export error: {e}")
        return {"error": str(e)}
    finally:
        db.close()


def _load_settings_and_email(report_files, report):
    """Send report via email if configured."""
    if not EMAIL_AVAILABLE:
        return
    import json
    if not os.path.exists(SETTINGS_PATH):
        return
    with open(SETTINGS_PATH) as f:
        settings = json.load(f)
    if not settings.get("email_enabled") or not settings.get("email_recipient"):
        return

    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    if not smtp_user or not smtp_pass:
        print("SMTP credentials not configured")
        return

    msg = MIMEMultipart()
    msg["From"] = smtp_user
    msg["To"] = settings["email_recipient"]
    msg["Subject"] = f'SmartParking Daily Report - {report["date_str"]}'

    body = f"""
Smart Parking Daily Report

Date: {report["today_str"]}
Generated: {report["generated_at"]}

Overview
- Total slots: {report["overview"]["total_slots"]}
- Available: {report["overview"]["available"]}
- Occupied: {report["overview"]["occupied"]}
- Occupancy: {report["overview"]["occupancy_pct"]}%

Revenue
- Today: ${report["revenue"]["today"]:.2f}
- This week: ${report["revenue"]["week"]:.2f}
- This month: ${report["revenue"]["month"]:.2f}
- Avg / vehicle: ${report["revenue"]["avg_per_vehicle"]:.2f}

Active alerts: {len(report["active_alerts"])}

Attached:
- PDF report
- Excel report
- CSV export
""".strip()
    msg.attach(MIMEText(body, "plain"))

    mime_types = {
        "pdf": ("application", "pdf"),
        "xlsx": ("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "csv": ("text", "csv"),
    }
    for key in ["pdf", "xlsx", "csv"]:
        main_type, sub_type = mime_types[key]
        with open(report_files[key]["path"], "rb") as f:
            attachment = MIMEApplication(f.read(), _subtype=sub_type)
        attachment.set_type(f"{main_type}/{sub_type}")
        attachment.add_header(
            "Content-Disposition",
            f'attachment; filename={report_files[key]["filename"]}',
        )
        msg.attach(attachment)

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
    print(f"Report emailed to {settings['email_recipient']}")


def _load_settings_and_s3(filepath, filename):
    """Upload report to S3 if configured."""
    if not S3_AVAILABLE:
        return
    import json
    if not os.path.exists(SETTINGS_PATH):
        return
    with open(SETTINGS_PATH) as f:
        settings = json.load(f)
    if not settings.get("s3_enabled") or not settings.get("s3_bucket"):
        return

    s3_key = os.getenv("AWS_ACCESS_KEY_ID", "")
    s3_secret = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    if not s3_key or not s3_secret:
        print("AWS credentials not configured")
        return

    s3 = boto3.client("s3")
    s3.upload_file(filepath, settings["s3_bucket"], f"reports/{filename}")
    print(f"Report uploaded to s3://{settings['s3_bucket']}/reports/{filename}")
