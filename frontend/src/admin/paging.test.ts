import type { Page } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE_SIZE, pageInfo } from './paging';

const page = (over: Partial<Page<unknown>>): Page<unknown> => ({
  items: [],
  total: 0,
  limit: 20,
  offset: 0,
  ...over,
});

describe('pageInfo', () => {
  it('describes the first of several pages', () => {
    expect(pageInfo(page({ items: new Array(20), total: 53, offset: 0 }))).toEqual({
      from: 1,
      to: 20,
      total: 53,
      prevOffset: null,
      nextOffset: 20,
    });
  });

  it('describes a middle page', () => {
    expect(pageInfo(page({ items: new Array(20), total: 53, offset: 20 }))).toEqual({
      from: 21,
      to: 40,
      total: 53,
      prevOffset: 0,
      nextOffset: 40,
    });
  });

  it('describes a short last page', () => {
    expect(pageInfo(page({ items: new Array(13), total: 53, offset: 40 }))).toEqual({
      from: 41,
      to: 53,
      total: 53,
      prevOffset: 20,
      nextOffset: null,
    });
  });

  it('has nowhere to go when everything fits on one page', () => {
    const info = pageInfo(page({ items: new Array(3), total: 3 }));
    expect(info).toMatchObject({ from: 1, to: 3, prevOffset: null, nextOffset: null });
  });

  it('reports an empty list as 0 of 0', () => {
    expect(pageInfo(page({}))).toEqual({
      from: 0,
      to: 0,
      total: 0,
      prevOffset: null,
      nextOffset: null,
    });
  });

  it('never steps back below the first record', () => {
    // e.g. the last row of the last page was just deleted and the offset is now too far
    expect(
      pageInfo(page({ items: new Array(5), total: 25, offset: 10, limit: 20 })).prevOffset,
    ).toBe(0);
  });

  it('uses the page size the server answered with', () => {
    expect(
      pageInfo(page({ items: new Array(10), total: 25, limit: 10, offset: 10 })),
    ).toMatchObject({
      prevOffset: 0,
      nextOffset: 20,
    });
  });
});

describe('ADMIN_PAGE_SIZE', () => {
  it('stays within what the API accepts', () => {
    expect(ADMIN_PAGE_SIZE).toBeGreaterThanOrEqual(1);
    expect(ADMIN_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
