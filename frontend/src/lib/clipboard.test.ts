import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('writes the text to the clipboard and reports success', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('Abc123')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('Abc123');
  });

  it('reports failure, without throwing, when the browser refuses (no permission)', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new DOMException('denied', 'NotAllowedError');
        }),
      },
    });
    await expect(copyText('Abc123')).resolves.toBe(false);
  });

  it('reports failure when the clipboard is not available at all (insecure page)', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyText('Abc123')).resolves.toBe(false);
  });
});
