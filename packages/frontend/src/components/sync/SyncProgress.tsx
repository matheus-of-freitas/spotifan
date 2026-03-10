import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSyncStatus, triggerSync } from '../../api/sync';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function SyncProgress() {
  const [syncError, setSyncError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const wasRunningRef = useRef(false);

  const { data: status } = useQuery({
    queryKey: ['sync', 'status'],
    queryFn: fetchSyncStatus,
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status;
      return currentStatus === 'running' ? 2000 : false;
    },
  });

  useEffect(() => {
    if (status?.status === 'running') {
      wasRunningRef.current = true;
    } else if (wasRunningRef.current && (status?.status === 'done' || status?.status === 'idle')) {
      wasRunningRef.current = false;
      void queryClient.invalidateQueries({ queryKey: ['releases'] });
    }
  }, [status?.status, queryClient]);

  const handleSync = async () => {
    setSyncError(null);
    try {
      await triggerSync();
      await queryClient.invalidateQueries({ queryKey: ['sync', 'status'] });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const isRunning = status?.status === 'running';
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
          <motion.button
            key="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => void handleSync()}
            disabled={isRunning}
            className="rounded-full bg-spotify-green px-4 py-2 text-sm font-semibold text-spotify-black transition-colors hover:bg-spotify-green-hover disabled:opacity-50"
          >
            Sync Library
          </motion.button>
        )}
      </AnimatePresence>
      {syncError && <span className="text-xs text-red-400">{syncError}</span>}
      {status?.status === 'error' && (
        <span className="text-xs text-red-400">
          Sync failed: {status.errorMessage ?? 'Unknown error'}
        </span>
      )}
    </div>
  );
}
