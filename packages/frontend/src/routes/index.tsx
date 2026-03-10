import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold text-spotify-green">Spotifan</h1>
    </div>
  );
}
