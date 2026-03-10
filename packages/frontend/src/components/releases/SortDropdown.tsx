import { useFilterStore } from '../../store/filterStore';

const SORT_OPTIONS = [
  { value: 'date', label: 'Release Date' },
  { value: 'artist', label: 'Artist Name' },
  { value: 'title', label: 'Album Title' },
] as const;

export function SortDropdown() {
  const sort = useFilterStore((s) => s.sort);
  const setSort = useFilterStore((s) => s.setSort);

  return (
    <select
      value={sort}
      onChange={(e) => setSort(e.target.value as 'date' | 'artist' | 'title')}
      className="rounded-md border border-spotify-gray-dark bg-spotify-card-bg px-3 py-2 text-sm text-spotify-white focus:border-spotify-green focus:outline-none"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
