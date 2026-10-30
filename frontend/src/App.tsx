import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ADMIN_SECTIONS, type AdminSection } from './admin/sections';
import { createQueryClient } from './auth/queryClient';
import { CATALOG_SECTIONS, type CatalogSection } from './catalog/sections';
import { AdminLayout } from './components/AdminLayout';
import { AppShell } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { CatalogLayout } from './components/CatalogLayout';
import { RequirePermission } from './components/RequirePermission';
import { AdminHomePage } from './pages/AdminHomePage';
import { BillingPage } from './pages/billing/BillingPage';
import { BillDetailPage } from './pages/bills/BillDetailPage';
import { BillsPage } from './pages/bills/BillsPage';
import { BranchPickerPage } from './pages/BranchPickerPage';
import { CatalogHomePage } from './pages/CatalogHomePage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { LoginPage } from './pages/LoginPage';
import { BranchesPage } from './pages/admin/BranchesPage';
import { ImportPage } from './pages/admin/ImportPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { CategoriesPage } from './pages/categories/CategoriesPage';
import { ItemsPage } from './pages/items/ItemsPage';
import { NoAccessPage } from './pages/NoAccessPage';
import { PurchaseEditorPage } from './pages/purchases/PurchaseEditorPage';
import { PurchasesPage } from './pages/purchases/PurchasesPage';
import { StatusPage } from './pages/StatusPage';
import { StockPage } from './pages/stock/StockPage';
import { VendorsPage } from './pages/vendors/VendorsPage';

const queryClient = createQueryClient();

// One page per Admin section; the sections list (admin/sections.ts) decides the address and the
// permission, so the links, the hub and these routes cannot drift apart
const ADMIN_PAGES: Record<AdminSection['slug'], ReactNode> = {
  branches: <BranchesPage />,
  users: <UsersPage />,
  settings: <SettingsPage />,
  import: <ImportPage />,
};

// The same for the catalog: one page per section, addressed and guarded from catalog/sections.ts
const CATALOG_PAGES: Record<CatalogSection['slug'], ReactNode> = {
  items: <ItemsPage />,
  categories: <CategoriesPage />,
  vendors: <VendorsPage />,
};

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
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminHomePage /> },
              ...ADMIN_SECTIONS.map((section) => ({
                path: section.slug,
                element: (
                  <RequirePermission permission={section.permission}>
                    {ADMIN_PAGES[section.slug]}
                  </RequirePermission>
                ),
              })),
            ],
          },
          {
            path: '/catalog',
            element: <CatalogLayout />,
            children: [
              { index: true, element: <CatalogHomePage /> },
              ...CATALOG_SECTIONS.map((section) => ({
                path: section.slug,
                element: (
                  <RequirePermission permission={section.permission}>
                    {CATALOG_PAGES[section.slug]}
                  </RequirePermission>
                ),
              })),
            ],
          },
          {
            path: '/stock',
            element: (
              <RequirePermission permission="stock:read">
                <StockPage />
              </RequirePermission>
            ),
          },
          {
            path: '/purchases',
            element: (
              <RequirePermission permission="purchase:write">
                <PurchasesPage />
              </RequirePermission>
            ),
          },
          {
            path: '/purchases/:id',
            element: (
              <RequirePermission permission="purchase:write">
                <PurchaseEditorPage />
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
          {
            path: '/bills',
            element: (
              <RequirePermission permission="bill:read">
                <BillsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/bills/:id',
            element: (
              <RequirePermission permission="bill:read">
                <BillDetailPage />
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
