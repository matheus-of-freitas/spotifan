import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSyncStatus, triggerSync } from '../../api/sync';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const JUST_TRIGGERED_TIMEOUT_MS = 30_000;

export function SyncProgress() {
  const [syncError, setSyncError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const wasRunningRef = useRef(false);
  const justTriggeredRef = useRef(false);
  const justTriggeredTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const clearJustTriggered = useCallback(() => {
    justTriggeredRef.current = false;
    if (justTriggeredTimerRef.current) {
      clearTimeout(justTriggeredTimerRef.current);
      justTriggeredTimerRef.current = undefined;
    }
  }, []);

  const { data: status, error: statusError } = useQuery({
    queryKey: ['sync', 'status'],
    queryFn: fetchSyncStatus,
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status;
      if (currentStatus === 'running' || justTriggeredRef.current) return 2000;
      return false;
    },
  });
  useEffect(() => {
    if (status?.status === 'running') {
      wasRunningRef.current = true;
      if (justTriggeredRef.current) {
        clearJustTriggered();
      }
    } else if (statusError) {
      wasRunningRef.current = false;
      clearJustTriggered();
    } else if (wasRunningRef.current && (status?.status === 'done' || status?.status === 'idle')) {
      wasRunningRef.current = false;
      void queryClient.invalidateQueries({ queryKey: ['releases'] });
    }
  }, [status?.status, statusError, queryClient, clearJustTriggered]);

  useEffect(() => {
    return () => {
      if (justTriggeredTimerRef.current) {
        clearTimeout(justTriggeredTimerRef.current);
      }
    };
  }, []);

  const handleSync = async (syncType: 'quick' | 'full') => {
    setSyncError(null);
    try {
      await triggerSync(syncType);
      justTriggeredRef.current = true;
      justTriggeredTimerRef.current = setTimeout(() => {
        justTriggeredRef.current = false;
      }, JUST_TRIGGERED_TIMEOUT_MS);
      await queryClient.invalidateQueries({ queryKey: ['sync', 'status'] });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const statusErrorMessage =
    statusError instanceof Error
      ? statusError.message
      : statusError
        ? 'Failed to fetch sync status'
        : null;
  const isRunning = status?.status === 'running' && !statusErrorMessage;
  const progress =
    isRunning && status.totalArtists > 0
      ? Math.round((status.processedArtists / status.totalArtists) * 100)
      : 0;

  return (
    <div className="flex items-center gap-4">
      <AnimatePresence mode="wait">
        {isRunning ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 200 }}
            exit={{ opacity: 0, width: 0 }}
            className="flex items-center gap-3"
          >
            <div className="h-2 w-full overflow-hidden rounded-full bg-spotify-gray-dark">
              <motion.div
                className="h-full rounded-full bg-spotify-green"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <span className="whitespace-nowrap text-xs text-spotify-gray-light">
              {status.processedArtists}/{status.totalArtists}
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="buttons"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2"
          >
            <button
              onClick={() => void handleSync('quick')}
              disabled={isRunning}
              className="rounded-full bg-spotify-green px-4 py-2 text-sm font-semibold text-spotify-black transition-colors hover:bg-spotify-green-hover disabled:opacity-50"
            >
              Quick Sync
            </button>
            <button
              onClick={() => void handleSync('full')}
              disabled={isRunning}
              className="rounded-full border border-spotify-green px-4 py-2 text-sm font-semibold text-spotify-green transition-colors hover:bg-spotify-green hover:text-spotify-black disabled:opacity-50"
            >
              Full Sync
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {syncError && <span className="text-xs text-red-400">{syncError}</span>}
      {statusErrorMessage && <span className="text-xs text-red-400">{statusErrorMessage}</span>}
      {status?.status === 'error' && (
        <span className="text-xs text-red-400">
          Sync failed: {status.errorMessage ?? 'Unknown error'}
        </span>
      )}
    </div>
  );
}
