import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/useAuth';
import { useEffect } from 'react';
import { Header } from '../components/layout/Header';
import { YearFilter } from '../components/releases/YearFilter';
import { SortDropdown } from '../components/releases/SortDropdown';
import { DateRangeFilter } from '../components/releases/DateRangeFilter';
import { GenreFilter } from '../components/releases/GenreFilter';
import { SearchInput } from '../components/releases/SearchInput';
import { ReleaseGrid } from '../components/releases/ReleaseGrid';
import { SyncProgress } from '../components/sync/SyncProgress';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      void navigate({ to: '/login' });
    }
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-spotify-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-spotify-green border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-spotify-black">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <YearFilter />
            <SortDropdown />
            <DateRangeFilter />
            <GenreFilter />
            <SearchInput />
          </div>
          <SyncProgress />
        </div>
        <ReleaseGrid />
      </main>
    </div>
  );
}
