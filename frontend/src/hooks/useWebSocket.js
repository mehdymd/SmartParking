import { useState, useEffect, useRef, useCallback } from 'react';
import { wsUrl } from '../lib/api';

export const useWebSocket = () => {
  const [status, setStatus] = useState('disconnected');
  const [data, setData] = useState({ status: {}, stats: {}, alerts: [] });
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const manualCloseRef = useRef(false);
  const reconnectDelayMs = 3000;

  const connect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manualCloseRef.current = false;
    setStatus('connecting');
    wsRef.current = new WebSocket(wsUrl('/ws/parking-updates'));

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
      wsRef.current = null;
      setStatus('disconnected');
      if (!manualCloseRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => connect(), reconnectDelayMs);
      }
    };

    wsRef.current.onerror = () => {
      setStatus('error');
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { status, data, reconnect: connect, disconnect };
};
