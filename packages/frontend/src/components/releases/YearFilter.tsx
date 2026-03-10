import { useQuery } from '@tanstack/react-query';
import { fetchYears } from '../../api/releases';
import { useFilterStore } from '../../store/filterStore';
import { cn } from '../../lib/utils';

export function YearFilter() {
  const { year: selectedYear, setYear } = useFilterStore();
  const { data: years } = useQuery({
    queryKey: ['releases', 'years'],
    queryFn: fetchYears,
  });

  if (!years || years.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => setYear(null)}
        className={cn(
          'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
          !selectedYear
            ? 'bg-spotify-green text-spotify-black'
            : 'bg-spotify-gray-dark text-spotify-white hover:bg-spotify-gray-dark/80',
        )}
      >
        All
      </button>
      {years.map((y) => (
        <button
          key={y}
          onClick={() => setYear(y)}
          className={cn(
            'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            selectedYear === y
              ? 'bg-spotify-green text-spotify-black'
              : 'bg-spotify-gray-dark text-spotify-white hover:bg-spotify-gray-dark/80',
          )}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
