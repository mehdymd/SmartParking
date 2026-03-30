import { useState, useEffect, useRef, useCallback } from 'react';
import { wsCandidates } from '../lib/api';

export const useWebSocket = () => {
  const [status, setStatus] = useState('disconnected');
  const [data, setData] = useState({ status: {}, stats: {}, alerts: [] });
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const manualCloseRef = useRef(false);
  const candidateIndexRef = useRef(0);
  const connectionAttemptRef = useRef(0);
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
    const candidates = wsCandidates('/ws/parking-updates');
    if (!candidates.length) {
      setStatus('error');
      return;
    }

    const attemptId = connectionAttemptRef.current + 1;
    connectionAttemptRef.current = attemptId;
    const startIndex = candidateIndexRef.current % candidates.length;
    const orderedCandidates = [
      ...candidates.slice(startIndex),
      ...candidates.slice(0, startIndex),
    ];

    const scheduleReconnect = () => {
      reconnectTimeoutRef.current = setTimeout(() => connect(), reconnectDelayMs);
    };

    const tryConnect = (candidatePosition) => {
      if (manualCloseRef.current || connectionAttemptRef.current !== attemptId) {
        return;
      }

      const socketUrl = orderedCandidates[candidatePosition];
      let socket = null;
      let opened = false;

      try {
        socket = new WebSocket(socketUrl);
      } catch (error) {
        if (candidatePosition < orderedCandidates.length - 1) {
          tryConnect(candidatePosition + 1);
          return;
        }
        console.error('WebSocket connection error:', error);
        setStatus('error');
        scheduleReconnect();
        return;
      }

      wsRef.current = socket;

      socket.onopen = () => {
        if (connectionAttemptRef.current !== attemptId) {
          socket.close();
          return;
        }
        opened = true;
        candidateIndexRef.current = candidates.indexOf(socketUrl);
        setStatus('connected');
      };

      socket.onmessage = (event) => {
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

      socket.onclose = () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (manualCloseRef.current || connectionAttemptRef.current !== attemptId) {
          return;
        }
        if (!opened && candidatePosition < orderedCandidates.length - 1) {
          tryConnect(candidatePosition + 1);
          return;
        }
        setStatus('disconnected');
        scheduleReconnect();
      };

      socket.onerror = () => {
        setStatus('error');
        if (socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
      };
    };

    tryConnect(0);
  }, []);

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    connectionAttemptRef.current += 1;
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
