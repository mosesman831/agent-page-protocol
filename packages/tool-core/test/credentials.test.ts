import { describe, expect, it } from 'vitest';
import { CredentialResolver, resolveCredentials } from '../src/index.js';

describe('credentials D-8', () => {
  it('env resolver reads NAME not value', () => {
    const prev = process.env.AGENT_PAGE_BEARER;
    process.env.AGENT_PAGE_BEARER = 'super-secret-bearer';
    try {
      const r = resolveCredentials({ bearerEnv: 'AGENT_PAGE_BEARER' });
      expect(r.envNames().bearerEnv).toBe('AGENT_PAGE_BEARER');
      expect(JSON.stringify(r.envNames())).not.toContain('super-secret-bearer');
      const headers = r.getAuthHeaders();
      expect(headers.Authorization).toBe('Bearer super-secret-bearer');
    } finally {
      if (prev === undefined) delete process.env.AGENT_PAGE_BEARER;
      else process.env.AGENT_PAGE_BEARER = prev;
    }
  });

  it('argv leak: function accepts names not values', () => {
    const token = 'this-must-not-be-an-argument';
    const r = new CredentialResolver({ bearerEnv: 'NOT_THE_TOKEN' });
    expect(r.bearerEnv).toBe('NOT_THE_TOKEN');
    expect(r.bearerEnv).not.toBe(token);
    expect(Object.values(r.envNames()).join(',')).not.toContain(token);
  });

  it('redactHeaders on a fake log sink', () => {
    const r = new CredentialResolver();
    const lines: string[] = [];
    r.logHeaders(
      {
        Authorization: 'Bearer abc',
        Cookie: 'sid=1',
        'X-APP-Confirmation': 'conf_x',
        'X-APP-Challenge': 'chg_x',
        Accept: 'application/vnd.agent-page+json',
      },
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).not.toContain('Bearer abc');
    expect(lines[0]).not.toContain('conf_x');
    expect(lines[0]).toContain('application/vnd.agent-page+json');
  });
});
