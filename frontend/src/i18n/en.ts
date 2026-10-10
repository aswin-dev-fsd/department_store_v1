// Every UI label (D-25). Tamil arrives later as a second dictionary with the same keys.
// Use {name} for values filled in by t(key, { name }).
export const en = {
  'app.name': 'Department Store',

  'status.title': 'System status',
  'status.apiLine': 'API: {status}',
  'status.databaseLine': 'Database: {status}',
  'status.checking': 'checking…',
  'status.ok': 'ok',
  'status.down': 'down',
  'status.unreachable': 'unreachable',
} as const;

export type MessageKey = keyof typeof en;
