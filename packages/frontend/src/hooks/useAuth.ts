import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchMe } from '../api/auth';
import { useEffect } from 'react';

export function useAuth() {
  const { user, isLoading, setUser, setLoading } = useAuthStore();

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMe,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (query.isSuccess) {
      setUser(query.data);
    } else if (query.isError) {
      setUser(null);
    } else if (query.isLoading) {
      setLoading(true);
    }
  }, [query.isSuccess, query.isError, query.isLoading, query.data, setUser, setLoading]);

  return {
    user,
    isLoading: isLoading && query.isLoading,
    isAuthenticated: !!user,
  };
}
