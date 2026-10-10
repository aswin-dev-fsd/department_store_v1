import type { RequestHandler } from 'express';
import { failure } from '../lib/response.js';

/** Answer any request no route matched with a 404 envelope. */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json(failure('NOT_FOUND', `No route for ${req.method} ${req.path}`));
};
