/** Data returned by GET /api/v1/health. */
export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  /** "down" when the database didn't answer within the ping timeout. */
  database: 'ok' | 'down';
}
