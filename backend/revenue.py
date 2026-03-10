PRICING = {
    'standard':   2.00,   # USD per hour
    'compact':    1.00,
    'large':      4.00,
}
GRACE_PERIOD_MINUTES = 15
MAX_DAILY_CHARGE     = 20.00

def calculate_fee(entry_time, exit_time, vehicle_type):
    duration_mins = (exit_time - entry_time).total_seconds() / 60
    billable_mins = max(0, duration_mins - GRACE_PERIOD_MINUTES)
    rate = PRICING.get(vehicle_type, PRICING['standard'])
    fee = (billable_mins / 60) * rate
    return round(min(fee, MAX_DAILY_CHARGE), 2)
