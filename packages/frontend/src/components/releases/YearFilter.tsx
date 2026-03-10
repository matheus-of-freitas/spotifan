import { useQuery } from '@tanstack/react-query';
import { fetchYears } from '../../api/releases';
import { useFilterStore } from '../../store/filterStore';

export function YearFilter() {
  const { year: selectedYear, setYear } = useFilterStore();
  const { data: years } = useQuery({
    queryKey: ['releases', 'years'],
    queryFn: fetchYears,
  });

  if (!years || years.length === 0) return null;

  return (
    <select
      value={selectedYear ?? ''}
      onChange={(e) => setYear(e.target.value || null)}
      className="rounded-full bg-spotify-gray-dark px-4 py-1.5 text-sm font-medium text-spotify-white transition-colors hover:bg-spotify-gray-dark/80 focus:outline-none focus:ring-2 focus:ring-spotify-green"
    >
      <option value="">All years</option>
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
