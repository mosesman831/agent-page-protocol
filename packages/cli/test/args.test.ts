import { describe, it, expect } from 'vitest';
import { inferParamValue, parseArgv, parseKeyValue, UsageError } from '../src/args.js';

describe('inferParamValue', () => {
  it('infers booleans, null, numbers, and strings', () => {
    expect(inferParamValue('true')).toBe(true);
    expect(inferParamValue('false')).toBe(false);
    expect(inferParamValue('null')).toBe(null);
    expect(inferParamValue('')).toBe('');
    expect(inferParamValue('42')).toBe(42);
    expect(inferParamValue('-3.5')).toBe(-3.5);
    expect(inferParamValue('2026-08-15')).toBe('2026-08-15');
    expect(inferParamValue('LHR')).toBe('LHR');
  });
});

describe('parseArgv', () => {
  it('parses --param and lets --params-json win on clash', () => {
    const p = parseArgv([
      'act',
      'filter',
      '--param',
      'max_price=1',
      '--params-json',
      '{"max_price":70000,"airline":"Emirates"}',
    ]);
    expect(p.command).toBe('act');
    expect(p.positional[0]).toBe('filter');
    expect(p.params.max_price).toBe(70000);
    expect(p.params.airline).toBe('Emirates');
  });

  it('last-flag-wins for --json vs --pretty', () => {
    const a = parseArgv(['--pretty', '--json', 'version']);
    expect(a.global.json).toBe(true);
    expect(a.global.pretty).toBe(false);

    const b = parseArgv(['--json', '--pretty', 'version']);
    expect(b.global.pretty).toBe(true);
    expect(b.global.json).toBe(false);
  });

  it('errors when act is missing action at command layer (positional empty)', () => {
    const p = parseArgv(['act', '--param', 'x=1']);
    expect(p.command).toBe('act');
    expect(p.positional.length).toBe(0);
  });

  it('parses KEY=VALUE positionals for act', () => {
    const p = parseArgv(['act', 'search', 'origin=LHR', 'passengers=1']);
    expect(p.params.origin).toBe('LHR');
    expect(p.params.passengers).toBe(1);
  });

  it('throws UsageError on bad --param', () => {
    expect(() => parseArgv(['act', 'x', '--param', 'nocolon'])).toThrow(UsageError);
  });
});

describe('parseKeyValue', () => {
  it('splits on first equals', () => {
    expect(parseKeyValue('a=b=c')).toEqual({ key: 'a', value: 'b=c' });
  });
});
