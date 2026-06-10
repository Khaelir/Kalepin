import { useCallback, useEffect, useRef, useState } from 'react';
import type { WSClient } from '../ws/ws-client';

export type SaveStatus = 'SYNCED' | 'DIRTY' | 'FLUSH_PENDING' | 'ERROR' | 'DISCONNECTED';

export function useSaveStatus(wsClient: WSClient, docId: string) {
  const [status, setStatus] = useState<SaveStatus>('SYNCED');
  const statusRef = useRef<SaveStatus>('SYNCED');

  const updateStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  // Mark dirty on local edit
  const markDirty = useCallback(() => {
    if (statusRef.current === 'SYNCED' || statusRef.current === 'FLUSH_PENDING') {
      updateStatus('DIRTY');
    }
  }, [updateStatus]);

  // Mark flush pending on ack (ops reached server memory)
  const markAcked = useCallback(() => {
    if (statusRef.current === 'DIRTY') {
      updateStatus('FLUSH_PENDING');
    }
  }, [updateStatus]);

  // Listen for flushed, flush:error, connected, disconnected
  useEffect(() => {
    const offFlushed = wsClient.on('flushed', (msg: any) => {
      if (msg.docId !== docId) return;
      // Flush confirmed — synced (unless new edits came in, which will re-dirty)
      if (statusRef.current === 'FLUSH_PENDING' || statusRef.current === 'DIRTY' || statusRef.current === 'ERROR') {
        updateStatus('SYNCED');
      }
    });

    const offFlushError = wsClient.on('flush:error', (msg: any) => {
      if (msg.docId !== docId) return;
      updateStatus('ERROR');
    });

    const offDisconnected = wsClient.on('disconnected', () => {
      updateStatus('DISCONNECTED');
    });

    const offConnected = wsClient.on('connected', () => {
      // Don't auto-transition to SYNCED here — wait for re-sync to complete
      // The re-sync logic in Editor.tsx will call resetToSynced after doc:opened
    });

    return () => {
      offFlushed();
      offFlushError();
      offDisconnected();
      offConnected();
    };
  }, [wsClient, docId, updateStatus]);

  // Reset to synced (called after successful re-sync)
  const resetToSynced = useCallback(() => {
    updateStatus('SYNCED');
  }, [updateStatus]);

  return { status, markDirty, markAcked, resetToSynced };
}
