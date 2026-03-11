import { useState, useEffect, useRef } from 'react';

export const useWebSocket = () => {
  const [status, setStatus] = useState('disconnected');
  const [data, setData] = useState({ status: {}, stats: {}, alerts: [] });
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayMs = 3000;

  const connect = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    wsRef.current = new WebSocket('ws://localhost:8000/ws/parking-updates');

    wsRef.current.onopen = () => {
      setStatus('connected');
    };

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'update':
            setData(prev => ({
              ...prev,
              status: message.status || {},
              stats: message.stats || {},
            }));
            break;
          case 'alert':
            setData(prev => ({ ...prev, alerts: [...prev.alerts, { ...message, ts: Date.now() }] }));
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
      reconnectTimeoutRef.current = setTimeout(() => connect(), reconnectDelayMs);
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
