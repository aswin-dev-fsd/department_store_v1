import { describe, expect, it } from 'vitest';
import { billsPath, DEFAULT_BILL_FILTERS } from './paths';

describe('billsPath', () => {
  it('asks for the first page of every bill by default', () => {
    expect(billsPath(DEFAULT_BILL_FILTERS, 0)).toBe('/bills?limit=20&offset=0');
  });

  it('sends every filter that is set, the phone as its 10 digits', () => {
    const path = billsPath(
      {
        billNo: 'TPR/26-27/00001',
        phone: '+91 98765 43210',
        from: '2026-10-01',
        to: '2026-10-30',
        status: 'cancelled',
      },
      40,
    );
    expect(path).toBe(
      '/bills?limit=20&offset=40&billNo=TPR%2F26-27%2F00001&phone=9876543210&from=2026-10-01&to=2026-10-30&status=cancelled',
    );
  });

  it('leaves out a phone that is not a mobile number', () => {
    expect(billsPath({ ...DEFAULT_BILL_FILTERS, phone: '12345' }, 0)).toBe(
      '/bills?limit=20&offset=0',
    );
  });
});
