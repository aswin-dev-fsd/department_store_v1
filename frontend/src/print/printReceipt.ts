import type { Receipt as ReceiptData } from '@ds/shared';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { api } from '../api/client';
import { Receipt } from '../pages/billing/Receipt';
import receiptCss from './receipt.css?raw';

/** How long a print frame may stay if the browser never says printing finished. */
const CLEANUP_AFTER_MS = 60_000;

/**
 * Print a saved bill's 80mm receipt (PD-04), from the server's receipt data, through a hidden
 * frame, so the billing screen stays as it is. With Chrome's `--kiosk-printing` it goes straight
 * to the default printer; otherwise the print dialog opens. Throws ApiError when the receipt
 * cannot be fetched: the bill itself is already saved, and can be reprinted from the Bills screen.
 */
export async function printReceipt(billId: number): Promise<void> {
  const receipt = await api.get<ReceiptData>(`/bills/${billId}/receipt`);

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  if (!frameWindow || !frameDocument) {
    frame.remove();
    throw new Error('The print frame could not be opened');
  }

  frameDocument.title = receipt.billNo;
  const style = frameDocument.createElement('style');
  style.textContent = receiptCss;
  frameDocument.head.appendChild(style);
  const container = frameDocument.createElement('div');
  frameDocument.body.appendChild(container);

  const root = createRoot(container);
  // Render now, so the receipt is on the page before print() reads it
  flushSync(() => root.render(createElement(Receipt, { receipt })));

  let removed = false;
  const cleanUp = () => {
    if (removed) return;
    removed = true;
    root.unmount();
    frame.remove();
  };
  frameWindow.addEventListener('afterprint', () => setTimeout(cleanUp, 0), { once: true });
  setTimeout(cleanUp, CLEANUP_AFTER_MS);

  frameWindow.focus();
  frameWindow.print();
}
