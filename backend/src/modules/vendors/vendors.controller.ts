import type { CreateVendorInput, IdParams, ListVendorsQuery, UpdateVendorInput } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { activeBranchId } from '../../lib/branch-scope.js';
import { success } from '../../lib/response.js';
import { requestContext } from '../../middleware/auth.js';
import * as service from './vendors.service.js';

/** Request handlers for /vendors — req/res only; the rules live in vendors.service. */
export function vendorsController({ db }: AppDeps) {
  const list: RequestHandler = async (req, res) => {
    res.json(
      success(
        await service.listVendors(
          db,
          activeBranchId(req),
          req.query as unknown as ListVendorsQuery,
        ),
      ),
    );
  };

  const create: RequestHandler = async (req, res) => {
    const vendor = await service.createVendor(
      db,
      requestContext(req),
      activeBranchId(req),
      req.body as CreateVendorInput,
      req.ip ?? null,
    );
    res.status(201).json(success(vendor));
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = req.params as unknown as IdParams;
    const vendor = await service.updateVendor(
      db,
      requestContext(req),
      activeBranchId(req),
      id,
      req.body as UpdateVendorInput,
      req.ip ?? null,
    );
    res.json(success(vendor));
  };

  return { list, create, update };
}
