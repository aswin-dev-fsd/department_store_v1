/**
 * Data returned by GET /api/v1/health/live — liveness only, never touches the database.
 * Used by Render's health check and keep-awake pings, so Neon can sleep (D-31).
 */
export interface LivenessStatus {
  status: 'ok';
  uptimeSeconds: number;
}

/** Data returned by GET /api/v1/health. */
export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  /** "down" when the database didn't answer within the ping timeout. */
  database: 'ok' | 'down';
}
