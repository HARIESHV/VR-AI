from collections import Counter
from datetime import datetime, timedelta, timezone

def build_insights(call_rows: list[dict]) -> dict:
    """Provides basic insights from call logs."""
    now = datetime.now(timezone.utc)
    # Filter calls from the last 7 days for better frequency analysis
    last_week = [c for c in call_rows if c["timestamp"] >= now - timedelta(days=7)]

    number_counts = Counter(c["phone"] for c in last_week)
    
    # Predict most frequently contacted people
    frequent_contacts = number_counts.most_common(5)

    alerts = []
    if len(last_week) >= 50:
        alerts.append("High call volume detected this week.")

    return {
        "total_calls_last_week": len(last_week),
        "frequent_contacts": frequent_contacts,
        "alerts": alerts,
    }

def detect_duplicates(contacts: list[dict]) -> list[dict]:
    """Detect potential duplicate contacts based on phone numbers or similar names."""
    duplicates = []
    seen_phones = {}
    seen_names = {}

    for contact in contacts:
        phone = contact.get("phone")
        name = contact.get("name", "").lower().strip()

        if phone in seen_phones:
            duplicates.append({
                "original": seen_phones[phone],
                "duplicate": contact,
                "reason": "Matching phone number"
            })
        else:
            seen_phones[phone] = contact

        if name in seen_names:
            # Simple name match, could be improved with fuzzy matching
            duplicates.append({
                "original": seen_names[name],
                "duplicate": contact,
                "reason": "Matching name"
            })
        else:
            seen_names[name] = contact

    return duplicates

def suggest_group(contact: dict, call_history: list[dict]) -> str:
    """Predict tag (Work, Family, Friends) based on usage patterns."""
    # This is a rule-based logic for now
    phone = contact.get("phone", "")
    calls = [c for c in call_history if c["phone"] == phone]
    
    if not calls:
        return "New"

    # Analyze call times
    work_hours_calls = 0
    weekend_calls = 0
    total_calls = len(calls)

    for call in calls:
        # Assuming timestamp is a datetime object
        dt = call["timestamp"]
        if dt.weekday() < 5: # Monday-Friday
            if 9 <= dt.hour <= 17:
                work_hours_calls += 1
        else:
            weekend_calls += 1

    if work_hours_calls / total_calls > 0.7:
        return "Work"
    if weekend_calls / total_calls > 0.4:
        return "Personal/Family"
    
    return "Friend"

