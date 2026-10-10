import type { ChangePasswordInput, LoginInput, SelectBranchInput } from '@ds/shared';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../../deps.js';
import { success } from '../../lib/response.js';
import { requestContext, SESSION_COOKIE, sessionCookieOptions } from '../../middleware/auth.js';
import * as service from './auth.service.js';

/** Request handlers for /auth — req/res only; the rules live in auth.service. */
export function authController({ db }: AppDeps) {
  const login: RequestHandler = async (req, res) => {
    const { username, password } = req.body as LoginInput;
    const { token, expiresAt, me } = await service.login(db, {
      username,
      password,
      ip: req.ip ?? null,
    });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    res.json(success(me));
  };

  const me: RequestHandler = async (req, res) => {
    res.json(success(await service.getMe(db, requestContext(req))));
  };

  const selectBranch: RequestHandler = async (req, res) => {
    const { branchId } = req.body as SelectBranchInput;
    res.json(
      success(await service.selectBranch(db, requestContext(req), branchId, req.ip ?? null)),
    );
  };

  const changePassword: RequestHandler = async (req, res) => {
    const input = req.body as ChangePasswordInput;
    res.json(success(await service.changePassword(db, requestContext(req), input, req.ip ?? null)));
  };

  const logout: RequestHandler = async (req, res) => {
    await service.logout(db, requestContext(req), req.ip ?? null);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.json(success({ loggedOut: true }));
  };

  return { login, me, selectBranch, changePassword, logout };
}
