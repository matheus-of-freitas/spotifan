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
    <header className="flex items-center justify-between border-b border-spotify-gray-dark px-6 py-4">
      <h1 className="text-xl font-bold text-spotify-green">Spotifan</h1>
      {user && (
        <div className="flex items-center gap-4">
          {user.imageUrl && (
            <img src={user.imageUrl} alt={user.displayName} className="h-8 w-8 rounded-full" />
          )}
          <span className="text-sm text-spotify-gray-light">{user.displayName}</span>
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
