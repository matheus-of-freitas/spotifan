import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../api/auth';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';

export function Header() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    void navigate({ to: '/login' });
  };

  return (
    <header className="flex items-center justify-between border-b border-spotify-gray-dark px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="#1DB954"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z" />
        </svg>
        <h1 className="text-xl font-bold text-spotify-green">Spotifan</h1>
      </div>
      {user && (
        <div className="flex items-center gap-4">
          {user.imageUrl && (
            <img src={user.imageUrl} alt={user.displayName} className="h-8 w-8 rounded-full" />
          )}
          <span className="hidden text-sm text-spotify-gray-light sm:inline">
            {user.displayName}
          </span>
          <button
            onClick={() => void handleLogout()}
            className="rounded px-3 py-1 text-sm text-spotify-gray-light transition-colors hover:text-spotify-white"
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
