import type { RequestContext } from '../middleware/auth.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireAuth: who is calling and which branch they work in. */
    ctx?: RequestContext;
  }
}
