from collections import Counter
from datetime import datetime, timedelta, timezone


def build_insights(call_rows: list[dict]) -> dict:
    now = datetime.now(timezone.utc)
    last_24h = [c for c in call_rows if c["call_time"] >= now - timedelta(hours=24)]

    number_counts = Counter(c["phone_number"] for c in last_24h)
    suspicious_numbers = [n for n, count in number_counts.items() if count >= 5]
    high_frequency = len(last_24h) >= 20
    spam_reports = sum(1 for c in last_24h if c["is_spam_reported"])

    alerts = []
    if high_frequency:
        alerts.append("Unusually high call volume detected in last 24 hours.")
    if suspicious_numbers:
        alerts.append("Repeated calls from same numbers suggest possible spam pattern.")
    if spam_reports > 0:
        alerts.append(f"{spam_reports} calls were manually flagged as spam.")

    return {
        "total_calls_last_24h": len(last_24h),
        "top_numbers": number_counts.most_common(5),
        "suspicious_numbers": suspicious_numbers,
        "spam_reports_last_24h": spam_reports,
        "alerts": alerts,
    }
