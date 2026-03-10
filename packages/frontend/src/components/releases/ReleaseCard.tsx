import { motion } from 'framer-motion';
import type { Release } from '../../api/releases';

interface ReleaseCardProps {
  release: Release;
  index: number;
}

export function ReleaseCard({ release, index }: ReleaseCardProps) {
  return (
    <motion.a
      href={release.spotifyUrl}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03 }}
      className="group block rounded-md bg-spotify-card-bg p-4 transition-colors hover:bg-spotify-gray-dark"
    >
      <div className="mb-4 aspect-square overflow-hidden rounded-md">
        {release.imageUrl ? (
          <img
            src={release.imageUrl}
            alt={release.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-spotify-gray-dark">
            <span className="text-4xl text-spotify-gray-light">&#9835;</span>
          </div>
        )}
      </div>
      <h3 className="truncate text-sm font-semibold text-spotify-white">{release.title}</h3>
      <p className="truncate text-xs text-spotify-gray-light">{release.artistName}</p>
      <p className="mt-1 text-xs text-spotify-gray-light">{release.releaseDate}</p>
    </motion.a>
  );
}
