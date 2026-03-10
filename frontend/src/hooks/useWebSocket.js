import { useState, useEffect, useRef } from 'react';

export const useWebSocket = () => {
  const [status, setStatus] = useState('disconnected');
  const [data, setData] = useState({ slots: {}, stats: {}, alerts: [] });
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayRef = useRef(5000); // Start with 5s

  const connect = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    wsRef.current = new WebSocket('ws://localhost:8000/ws/parking-updates');

    wsRef.current.onopen = () => {
      setStatus('connected');
      reconnectDelayRef.current = 5000; // Reset delay
    };

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'slot_update':
            setData(prev => ({
              ...prev,
              slots: { ...prev.slots, [message.slot_id]: { status: message.status, vehicle_type: message.vehicle_type, plate: message.plate, speed_kmh: message.speed_kmh } }
            }));
            break;
          case 'stats_update':
            setData(prev => ({ ...prev, stats: { total: message.total, available: message.available, occupied: message.occupied, rate: message.rate } }));
            break;
          case 'wrong_way_alert':
          case 'speed_alert':
          case 'abandoned_alert':
          case 'type_mismatch_alert':
            setData(prev => ({ ...prev, alerts: [...prev.alerts, message] }));
            break;
          case 'revenue_update':
            // Handle revenue
            break;
          case 'lpr_update':
            // Handle LPR
            break;
          default:
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    wsRef.current.onclose = () => {
      setStatus('disconnected');
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000); // Exponential backoff, max 30s
        connect();
      }, reconnectDelayRef.current);
    };

    wsRef.current.onerror = () => {
      setStatus('error');
    };
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
  };

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  return { status, data, reconnect: connect, disconnect };
};
