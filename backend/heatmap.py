import random

def get_heatmap(range_days=30):
    # Placeholder: generate random occupancy rates per zone per hour
    # In real implementation, aggregate from ParkingHistory
    zones = ['A', 'B', 'C']
    matrix = {}
    for zone in zones:
        matrix[zone] = [round(random.random(), 2) for _ in range(24)]
    return matrix
