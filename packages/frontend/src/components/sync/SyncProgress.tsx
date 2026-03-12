import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSyncStatus, triggerSync } from '../../api/sync';
import { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

const JUST_TRIGGERED_TIMEOUT_MS = 30_000;

export function SyncProgress() {
  const queryClient = useQueryClient();
  const wasRunningRef = useRef(false);
  const justTriggeredRef = useRef(false);
  const justTriggeredTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevStatusRef = useRef<string | undefined>(undefined);
  const [isTriggerPending, setIsTriggerPending] = useState(false);

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
      setIsTriggerPending(false);
      if (justTriggeredRef.current) {
        clearJustTriggered();
      }
    } else if (statusError) {
      wasRunningRef.current = false;
      setIsTriggerPending(false);
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
    /* v8 ignore next -- buttons hidden when running; defensive guard only */
    if (isTriggerPending || isRunning) return;
    try {
      await triggerSync(syncType);
      setIsTriggerPending(true);
      justTriggeredRef.current = true;
      justTriggeredTimerRef.current = setTimeout(() => {
        justTriggeredRef.current = false;
        setIsTriggerPending(false);
      }, JUST_TRIGGERED_TIMEOUT_MS);
      await queryClient.invalidateQueries({ queryKey: ['sync', 'status'] });
    } catch (err) {
      setIsTriggerPending(false);
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const statusErrorMessage =
    statusError instanceof Error
      ? statusError.message
      : statusError
        ? 'Failed to fetch sync status'
        : null;

  useEffect(() => {
    if (statusErrorMessage) {
      toast.error(statusErrorMessage);
    }
  }, [statusErrorMessage]);

  useEffect(() => {
    if (status?.status === 'error' && prevStatusRef.current === 'running') {
      toast.error(`Sync failed: ${status.errorMessage ?? 'Unknown error'}`);
    }
    prevStatusRef.current = status?.status;
  }, [status?.status, status?.errorMessage]);

  const isRunning = status?.status === 'running' && !statusErrorMessage;
  const hasFullSync = status?.lastFullSyncAt != null;
  const showProgress = isRunning || isTriggerPending;
  const progress =
    isRunning && status.totalArtists > 0
      ? Math.round((status.processedArtists / status.totalArtists) * 100)
      : 0;

  return (
    <div className="flex items-center gap-4">
      <AnimatePresence mode="wait">
        {showProgress ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 200 }}
            exit={{ opacity: 0, width: 0 }}
            className="flex items-center gap-3"
          >
            <div className="h-2 w-full overflow-hidden rounded-full bg-spotify-gray-dark">
              {isRunning ? (
                <motion.div
                  className="h-full rounded-full bg-spotify-green"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              ) : (
                <motion.div
                  className="h-full rounded-full bg-spotify-green"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ width: '40%' }}
                />
              )}
            </div>
            <span className="whitespace-nowrap text-xs text-spotify-gray-light">
              {isRunning ? `${status.processedArtists}/${status.totalArtists}` : '…'}
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
            {hasFullSync && (
              <button
                onClick={() => void handleSync('quick')}
                className="rounded-full bg-spotify-green px-4 py-2 text-sm font-semibold text-spotify-black transition-colors hover:bg-spotify-green-hover"
              >
                Quick Sync
              </button>
            )}
            <button
              onClick={() => void handleSync('full')}
              className="rounded-full border border-spotify-green px-4 py-2 text-sm font-semibold text-spotify-green transition-colors hover:bg-spotify-green hover:text-spotify-black"
            >
              Full Sync
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
