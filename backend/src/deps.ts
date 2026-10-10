import type { Db } from '@ds/database';

/** What route modules need from outside — passed into createApp so tests can supply their own. */
export interface AppDeps {
  db: Db;
}
