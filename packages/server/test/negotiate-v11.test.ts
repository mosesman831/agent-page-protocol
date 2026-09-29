import { describe, it, expect } from 'vitest';
import { negotiate, selectProtocolVersion } from '../src/negotiate.js';
import { MEDIA_PAGE } from '../src/media-types.js';

describe('K3 MF-3 version selection', () => {
  it('selects 1.0 when Accept-Versions is 1.1,1.0 against a 1.0-only server and ignores v=1.1', () => {
    const neg = negotiate(`${MEDIA_PAGE};v=1.1`, {
      method: 'GET',
      acceptVersions: '1.1, 1.0',
      supportedVersions: ['1.0'],
    });
    expect(neg.acceptable).toBe(true);
    expect(neg.versionMismatch).toBeFalsy();
    expect(neg.versionUnsupported).toBeFalsy();
    expect(neg.selectedVersion).toBe('1.0');
  });

  it('returns 406 unsupported when no mutual version exists', () => {
    const neg = negotiate(MEDIA_PAGE, {
      method: 'GET',
      acceptVersions: '1.1',
      supportedVersions: ['1.0'],
    });
    expect(neg.acceptable).toBe(false);
    expect(neg.versionUnsupported).toBe(true);
    expect(neg.versionMismatch).toBeFalsy();
    expect(neg.highestOffered).toBe('1.1');
  });

  it('returns 400 version_mismatch when v= names unsupported and no mutual', () => {
    const neg = negotiate(`${MEDIA_PAGE};v=1.1`, {
      method: 'GET',
      acceptVersions: '1.1',
      supportedVersions: ['1.0'],
    });
    expect(neg.acceptable).toBe(false);
    expect(neg.versionMismatch).toBe(true);
    expect(neg.highestOffered).toBe('1.1');
  });

  it('selects 1.1 when both sides support it', () => {
    const sel = selectProtocolVersion({
      acceptVersions: '1.1, 1.0',
      supported: ['1.0', '1.1'],
    });
    expect(sel.none).toBe(false);
    expect(sel.selected).toBe('1.1');
    expect(sel.highestOffered).toBe('1.1');
  });
});
