import { computeBill } from '@ds/shared';
import { describe, expect, it } from 'vitest';
import { billDraftReducer, EMPTY_DRAFT, summarizeDraft, type BillDraft } from './useBillDraft';

// The overview §6.4 items
const rice = { id: 1, code: 'R10', name: 'Rice 10 kg', mrpPaise: 68000, sellingPricePaise: 65000, stock: 5 };
const oil = { id: 2, code: 'O1', name: 'Sunflower Oil 1 L', mrpPaise: 15000, sellingPricePaise: 14550, stock: 50 };
const soap = { id: 3, code: 'S100', name: 'Bath Soap 100 g', mrpPaise: 4000, sellingPricePaise: 3825, stock: 50 };

function add(state: BillDraft, ...items: (typeof rice)[]): BillDraft {
  return items.reduce((next, item) => billDraftReducer(next, { type: 'add', item }), state);
}

describe('billDraftReducer', () => {
  it('adds a new item as a line of 1, at the bottom', () => {
    const draft = add(EMPTY_DRAFT, rice, oil);
    expect(draft.lines.map((line) => [line.code, line.quantity, line.discount])).toEqual([
      ['R10', '1', ''],
      ['O1', '1', ''],
    ]);
    expect(draft.lines[0]).toMatchObject({ unitPricePaise: 65000, mrpPaise: 68000, stock: 5 });
  });

  it('adds 1 to the line when the same item is added again, as a second scan does', () => {
    const draft = add(EMPTY_DRAFT, rice, oil, rice, rice);
    expect(draft.lines.map((line) => [line.code, line.quantity])).toEqual([
      ['R10', '3'],
      ['O1', '1'],
    ]);
  });

  it('counts from 0 when the line had an unreadable quantity', () => {
    let draft = add(EMPTY_DRAFT, rice);
    draft = billDraftReducer(draft, { type: 'setQuantity', key: draft.lines[0]!.key, quantity: '' });
    draft = add(draft, rice);
    expect(draft.lines[0]!.quantity).toBe('1');
  });

  it('changes a quantity and a discount, leaving the other lines alone', () => {
    let draft = add(EMPTY_DRAFT, rice, oil);
    const [first, second] = draft.lines;
    draft = billDraftReducer(draft, { type: 'setQuantity', key: second!.key, quantity: '2' });
    draft = billDraftReducer(draft, { type: 'setDiscount', key: first!.key, discount: '20' });
    expect(draft.lines.map((line) => [line.quantity, line.discount])).toEqual([
      ['1', '20'],
      ['2', ''],
    ]);
  });

  it('removes a line', () => {
    let draft = add(EMPTY_DRAFT, rice, oil, soap);
    draft = billDraftReducer(draft, { type: 'remove', key: draft.lines[1]!.key });
    expect(draft.lines.map((line) => line.code)).toEqual(['R10', 'S100']);
  });

  it('starts again empty after the bill is saved (reset)', () => {
    const draft = add(EMPTY_DRAFT, rice, oil);
    expect(billDraftReducer(draft, { type: 'reset' })).toEqual(EMPTY_DRAFT);
  });
});

describe('summarizeDraft', () => {
  /** The worked example: rice ₹20 off, 2 oil, 3 soap. */
  function workedExample(): BillDraft {
    let draft = add(EMPTY_DRAFT, rice, oil, oil, soap, soap, soap);
    draft = billDraftReducer(draft, { type: 'setDiscount', key: draft.lines[0]!.key, discount: '20' });
    return draft;
  }

  it('totals the bill with the shared computeBill: the overview §6.4 example', () => {
    const summary = summarizeDraft(workedExample());
    expect(summary.totals).toMatchObject({
      subtotalPaise: 105575,
      discountPaise: 2000,
      roundOffPaise: 25,
      totalPaise: 103600,
    });
    expect(summary.totals).toEqual(
      computeBill([
        { unitPricePaise: 65000, quantity: 1, discountPaise: 2000 },
        { unitPricePaise: 14550, quantity: 2, discountPaise: 0 },
        { unitPricePaise: 3825, quantity: 3, discountPaise: 0 },
      ]),
    );
    expect(summary.lines.map((line) => line.lineTotalPaise)).toEqual([63000, 29100, 11475]);
    expect(summary.ready).toBe(true);
    expect(summary.input).toEqual([
      { itemId: 1, quantity: 1, discountPaise: 2000 },
      { itemId: 2, quantity: 2, discountPaise: 0 },
      { itemId: 3, quantity: 3, discountPaise: 0 },
    ]);
  });

  it('recalculates when a quantity or discount changes', () => {
    let draft = workedExample();
    draft = billDraftReducer(draft, { type: 'setQuantity', key: draft.lines[2]!.key, quantity: '4' });
    draft = billDraftReducer(draft, { type: 'setDiscount', key: draft.lines[0]!.key, discount: '' });
    // 65000 + 29100 + 4 × 3825 = 109400
    expect(summarizeDraft(draft).totals).toMatchObject({
      subtotalPaise: 109400,
      discountPaise: 0,
      totalPaise: 109400,
    });
  });

  it.each([
    ['a blank quantity', { quantity: '' }, 'Enter a whole number of packs, like 2.'],
    ['a quantity of 0', { quantity: '0' }, 'Enter a whole number of packs, like 2.'],
    ['a part pack', { quantity: '1.5' }, 'Enter a whole number of packs, like 2.'],
    ['a discount that is not an amount', { discount: 'ten' }, 'Write the discount in rupees, like 20.50.'],
    ['a discount above the line amount', { discount: '650.01' }, 'The discount cannot be more than the line amount.'],
  ])('flags %s on its line, leaves it out of the totals, and is not ready', (_label, change, problem) => {
    let draft = add(EMPTY_DRAFT, rice, oil);
    const key = draft.lines[0]!.key;
    if ('quantity' in change) draft = billDraftReducer(draft, { type: 'setQuantity', key, quantity: change.quantity });
    if ('discount' in change) draft = billDraftReducer(draft, { type: 'setDiscount', key, discount: change.discount });

    const summary = summarizeDraft(draft);
    expect(summary.lines[0]).toMatchObject({ lineTotalPaise: null, problem });
    expect(summary.totals).toMatchObject({ subtotalPaise: 14550 });
    expect(summary.ready).toBe(false);
  });

  it('allows a discount equal to the line amount', () => {
    let draft = add(EMPTY_DRAFT, rice);
    draft = billDraftReducer(draft, { type: 'setDiscount', key: draft.lines[0]!.key, discount: '650' });
    expect(summarizeDraft(draft).lines[0]).toMatchObject({ lineTotalPaise: 0, problem: null });
  });

  it('warns when a quantity is above the stock shown, but still lets the server decide', () => {
    let draft = add(EMPTY_DRAFT, rice);
    draft = billDraftReducer(draft, { type: 'setQuantity', key: draft.lines[0]!.key, quantity: '6' });
    const summary = summarizeDraft(draft);
    expect(summary.lines[0]).toMatchObject({ overStock: true, problem: null });
    expect(summary.ready).toBe(true);
  });

  it('has no totals and is not ready while the bill is empty', () => {
    expect(summarizeDraft(EMPTY_DRAFT)).toEqual({ lines: [], totals: null, ready: false, input: [] });
  });
});
