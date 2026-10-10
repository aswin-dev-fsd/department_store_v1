import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { StatusPage } from './pages/StatusPage';

const queryClient = new QueryClient({
  defaultOptions: {
    // One retry covers a sleeping free-tier backend without hiding real outages
    queries: { retry: 1 },
  },
});

const router = createBrowserRouter([
  { path: '/', element: <StatusPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

/** App root: data fetching and routing. Screens are added per phase. */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
