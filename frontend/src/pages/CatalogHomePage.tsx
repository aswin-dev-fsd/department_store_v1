import { Navigate } from 'react-router-dom';
import { useMe } from '../auth/queries';
import { visibleCatalogSections } from '../catalog/sections';
import { NoAccessPage } from './NoAccessPage';

/** /catalog itself has no page of its own: it opens the first section the person may use. */
export function CatalogHomePage() {
  const me = useMe().data;
  if (!me) return null;
  const first = visibleCatalogSections(me.permissions)[0];
  return first ? <Navigate to={first.path} replace /> : <NoAccessPage />;
}
