import type { LookupCustomerQuery } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { success } from '../../lib/response.js';
import * as service from './customers.service.js';

/** Request handlers for /customers — req/res only; the rules live in customers.service. */
export function customersController({ db }: AppDeps) {
  const lookup: RequestHandler = async (req, res) => {
    const { phone } = req.query as unknown as LookupCustomerQuery;
    res.json(success(await service.lookupCustomer(db, phone)));
  };

  return { lookup };
}
