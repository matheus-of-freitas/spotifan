import { useState, useEffect } from 'react';
import { useFilterStore } from '../../store/filterStore';

export function SearchInput() {
  const search = useFilterStore((s) => s.search);
  const setSearch = useFilterStore((s) => s.setSearch);
  const [local, setLocal] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(local), 300);
    return () => clearTimeout(timer);
  }, [local, setSearch]);

  useEffect(() => {
    if (search === '') setLocal('');
  }, [search]);

  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder="Search releases..."
      className="rounded-md border border-spotify-gray-dark bg-spotify-card-bg px-3 py-2 text-sm text-spotify-white placeholder-spotify-gray-light transition-colors focus:border-spotify-green focus:outline-none"
    />
  );
}
