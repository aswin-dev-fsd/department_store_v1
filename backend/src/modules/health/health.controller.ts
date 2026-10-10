import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { success } from '../../lib/response.js';
import { checkHealth, checkLiveness } from './health.service.js';

/** Request handlers for /health. */
export function healthController({ db }: AppDeps) {
  const get: RequestHandler = async (_req, res) => {
    res.json(success(await checkHealth(db)));
  };
  const live: RequestHandler = (_req, res) => {
    res.json(success(checkLiveness()));
  };
  return { get, live };
}
