import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { createQueryClient } from './auth/queryClient';
import { AppShell } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { RequirePermission } from './components/RequirePermission';
import { AdminHomePage } from './pages/AdminHomePage';
import { BillingPage } from './pages/BillingPage';
import { BranchPickerPage } from './pages/BranchPickerPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { LoginPage } from './pages/LoginPage';
import { NoAccessPage } from './pages/NoAccessPage';
import { StatusPage } from './pages/StatusPage';

const queryClient = createQueryClient();

const router = createBrowserRouter([
  // Public: works without logging in (Phase 1 smoke test)
  { path: '/status', element: <StatusPage /> },
  {
    // Everything else waits for "who is logged in" and redirects as needed (auth/routing.ts)
    element: <AuthGate />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/change-password', element: <ChangePasswordPage /> },
          { path: '/select-branch', element: <BranchPickerPage /> },
          { path: '/no-access', element: <NoAccessPage /> },
          {
            path: '/admin',
            element: (
              <RequirePermission permission="admin:branches">
                <AdminHomePage />
              </RequirePermission>
            ),
          },
          {
            path: '/billing',
            element: (
              <RequirePermission permission="bill:create">
                <BillingPage />
              </RequirePermission>
            ),
          },
        ],
      },
      // "/" is redirected to the role home by the gate; anything unknown goes there too
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

/** App root: data fetching and routing. */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
