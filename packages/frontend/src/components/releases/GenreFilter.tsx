import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useEffect } from 'react';
import { fetchGenres } from '../../api/releases';
import { useFilterStore } from '../../store/filterStore';

export function GenreFilter() {
  const [isOpen, setIsOpen] = useState(false);
  const selectedGenres = useFilterStore((s) => s.genres);
  const toggleGenre = useFilterStore((s) => s.toggleGenre);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: fetchGenres,
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (genres.length === 0) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`rounded-md border px-3 py-2 text-sm transition-colors ${
          selectedGenres.length > 0
            ? 'border-spotify-green bg-spotify-green/10 text-spotify-green'
            : 'border-spotify-gray-dark bg-spotify-card-bg text-spotify-gray-light'
        } focus:border-spotify-green focus:outline-none`}
      >
        Genres{selectedGenres.length > 0 ? ` (${selectedGenres.length})` : ''}
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-10 mt-1 max-h-60 w-56 overflow-y-auto rounded-md border border-spotify-gray-dark bg-spotify-card-bg shadow-lg">
          {genres.map((genre) => (
            <label
              key={genre}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-spotify-gray-light hover:bg-spotify-gray-dark/50 hover:text-spotify-white"
            >
              <input
                type="checkbox"
                checked={selectedGenres.includes(genre)}
                onChange={() => toggleGenre(genre)}
                className="accent-spotify-green"
              />
              {genre}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
