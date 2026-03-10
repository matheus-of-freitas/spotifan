import { createFileRoute } from '@tanstack/react-router';
import { motion } from 'framer-motion';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-spotify-black">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <h1 className="mb-2 text-5xl font-bold text-spotify-white">Spotifan</h1>
        <p className="mb-8 text-spotify-gray-light">
          Never miss an album from the artists you follow
        </p>
        <a
          href="/api/auth/login"
          className="inline-flex items-center rounded-full bg-spotify-green px-8 py-3 text-lg font-semibold text-spotify-black transition-colors hover:bg-spotify-green-hover"
        >
          Log in with Spotify
        </a>
      </motion.div>
    </div>
  );
}
