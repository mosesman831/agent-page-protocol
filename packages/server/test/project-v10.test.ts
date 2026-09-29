import { describe, it, expect } from 'vitest';
import { projectManifestToV10, projectStateNodeToV10 } from '../src/project-v10.js';
import type { ActionDef, GeoPointStateNode, PageManifest } from '../src/types.js';

describe('1.0 projection (§2.5)', () => {
  it('projects geopoint to object lat/lng number nodes', () => {
    const geo: GeoPointStateNode = {
      type: 'geopoint',
      label: 'Pickup',
      value: { lat: 51.47, lng: -0.4543, accuracy_m: 30, label: 'LHR T5' },
    };
    const projected = projectStateNodeToV10(geo);
    expect(projected).toEqual({
      type: 'object',
      label: 'Pickup',
      value: {
        lat: { type: 'number', value: 51.47 },
        lng: { type: 'number', value: -0.4543 },
        accuracy_m: { type: 'number', value: 30 },
        label: { type: 'string', value: 'LHR T5' },
      },
    });
  });

  it('projects quantity to number+unit and preserves money integer+scale on order', () => {
    const qty = projectStateNodeToV10({
      type: 'quantity',
      value: { value: 3500, unit: 'g' },
      scale: 0,
    } as never);
    expect(qty).toMatchObject({ type: 'number', value: 3500, unit: 'g', scale: 0 });

    const order = projectStateNodeToV10({
      type: 'order',
      value: { id: 'ord_1', status: 'paid', currency: 'GBP', total: 64000, scale: 2 },
    } as never);
    expect(order.type).toBe('object');
    const value = (
      order as {
        value: Record<string, { type: string; value: unknown; scale?: number; unit?: string }>;
      }
    ).value;
    expect(value.status.type).toBe('enum');
    expect(value.total).toMatchObject({ type: 'number', value: 64000, scale: 2, unit: 'GBP' });
  });

  it('omits 1.1 ActionDef keys, page.focus/time_zone, options_source on app 1.0 documents', () => {
    const def: ActionDef = {
      description: 'x',
      kind: 'mutate',
      bulk: { max_items: 10, mode: 'all_or_nothing' },
      input: {
        dest: {
          type: 'string',
          options_source: { action: 'search', param: 'q', results_path: 'suggestions' },
        },
        receipt: { type: 'file', transfer: 'presign', accept_mime: ['application/pdf'] },
      },
      output: { resume_url: 'https://example.com/back' },
      policy: { consent_purposes: ['analytics'], step_up: true },
    };
    const manifest: PageManifest = {
      app: '1.1',
      page: {
        id: 'p',
        url: 'https://example.com/p',
        version: 'v1',
        focus: '/state/results',
        time_zone: 'Europe/London',
      },
      state: {
        pickup: { type: 'geopoint', value: { lat: 1, lng: 2 } },
      },
      actions: { do: def },
      navigation: { anchors: [{ id: 'results', label: 'Results', pointer: '/state/results' }] },
      error: { code: 'x', message: 'm', message_id: 'err.x', retry_class: 'none' } as never,
    };
    const v10 = projectManifestToV10(manifest);
    expect(v10.app).toBe('1.0');
    expect(v10.page.focus).toBeUndefined();
    expect(v10.page.time_zone).toBeUndefined();
    expect(v10.state.pickup.type).toBe('object');
    expect(v10.actions?.do.bulk).toBeUndefined();
    expect(v10.actions?.do.output?.resume_url).toBeUndefined();
    expect(v10.actions?.do.policy?.consent_purposes).toBeUndefined();
    expect(v10.actions?.do.input?.dest.options_source).toBeUndefined();
    expect(v10.actions?.do.input?.receipt.type).toBe('string');
    expect(v10.actions?.do.input?.receipt.upload).toBe(true);
    expect(v10.navigation?.anchors).toBeUndefined();
    expect((v10.error as { message_id?: string } | undefined)?.message_id).toBeUndefined();
  });
});
