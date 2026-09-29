import { describe, expect, it } from 'vitest';
import { stateDelta } from '../src/index.js';
import type { PageManifest } from '@agent-page/client';

describe('stateDelta §5.2', () => {
  it('patch /state/results + /state/total_results yields those two keys only', () => {
    const post: PageManifest = {
      app: '1.0',
      page: { id: 'results', url: 'http://localhost:3456/flights/x', version: 'v4' },
      state: {
        results: { type: 'table', fields: { id: 'string' }, value: [['fl-002']] },
        total_results: { type: 'number', value: 1 },
        currency: { type: 'string', value: 'GBP' },
      },
    };
    const { state_delta, actions_delta } = stateDelta(
      [
        { op: 'replace', path: '/state/results', value: post.state.results },
        { op: 'replace', path: '/state/total_results', value: post.state.total_results },
        { op: 'replace', path: '/present/layout', value: 'x' },
      ],
      post,
    );
    expect(Object.keys(state_delta).sort()).toEqual(['results', 'total_results']);
    expect(state_delta.results).toEqual(post.state.results);
    expect(state_delta.total_results).toEqual(post.state.total_results);
    expect(state_delta).not.toHaveProperty('currency');
    expect(state_delta).not.toHaveProperty('present');
    expect(actions_delta).toEqual({ added: [], removed: [], replaced: [] });
  });

  it('removed state key becomes null; actions_delta from /actions/*', () => {
    const post: PageManifest = {
      app: '1.0',
      page: { id: 'p', url: 'http://localhost/p', version: 'v2' },
      state: { keep: { type: 'string', value: 'yes' } },
      actions: { filter: { description: 'f', kind: 'query' } },
    };
    const { state_delta, actions_delta } = stateDelta(
      [
        { op: 'remove', path: '/state/gone' },
        { op: 'add', path: '/actions/filter', value: {} },
        { op: 'remove', path: '/actions/old' },
        { op: 'replace', path: '/actions/search/description', value: 'x' },
      ],
      post,
    );
    expect(state_delta.gone).toBeNull();
    expect(actions_delta.added).toEqual(['filter']);
    expect(actions_delta.removed).toEqual(['old']);
    expect(actions_delta.replaced).toEqual(['search']);
  });
});
