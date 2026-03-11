import { useFilterStore } from '../../store/filterStore';

const PRESETS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '15d', label: 'Last 15 days' },
  { value: '1m', label: 'Last month' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
] as const;

export function DateRangeFilter() {
  const dateRange = useFilterStore((s) => s.dateRange);
  const setDateRange = useFilterStore((s) => s.setDateRange);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            onClick={() => setDateRange(dateRange === preset.value ? null : preset.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              dateRange === preset.value
                ? 'bg-spotify-green text-spotify-black'
                : 'bg-spotify-card-bg text-spotify-gray-light hover:text-spotify-white'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
