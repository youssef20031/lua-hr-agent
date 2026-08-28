/**
 * Tests for the LIVE BambooHR adapter's record mapping.
 *
 * The fixture client had 44 tests and the HTTP client had none, which is how a
 * 12x wage error survived: BambooHR returns `payRate` on whatever basis
 * `payPer` says, and a tenant paying annually made every gratuity twelve times
 * too large. These stub only the network boundary so the real request path,
 * field list and mapping all execute.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpHrisClient } from '../src/services/bamboohr/http.js';

/** One JSON response, recording the URL it was asked for. */
function stubFetch(payload: unknown): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
    };
  });
  return { calls };
}

const client = (): HttpHrisClient =>
  new HttpHrisClient({ companyDomain: 'trial32be1244', apiKey: 'test-key' });

/** A record shaped like the one the live trial tenant actually returns. */
const londonAnnual = {
  id: '4',
  firstName: 'Charlotte',
  lastName: 'Abbott',
  displayName: 'Charlotte Abbott',
  hireDate: '2025-03-19',
  country: 'United Kingdom',
  location: 'London, UK',
  payRate: '60000.00 GBP',
  payPer: 'Year',
  department: 'Human Resources',
  jobTitle: 'Sr. HR Administrator',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pay basis', () => {
  it('converts an annual pay rate to a monthly wage', async () => {
    stubFetch(londonAnnual);
    const employee = await client().getEmployee('4');
    expect(employee?.monthlyWage).toBe(5000);
  });

  it('leaves a monthly pay rate alone', async () => {
    stubFetch({ ...londonAnnual, payRate: '12000.00 SAR', payPer: 'Month' });
    const employee = await client().getEmployee('4');
    expect(employee?.monthlyWage).toBe(12000);
  });

  it('requests payPer, so the pay basis is knowable at all', async () => {
    const { calls } = stubFetch(londonAnnual);
    await client().getEmployee('4');
    expect(decodeURIComponent(calls[0] ?? '')).toContain('payPer');
  });
});

describe('currency', () => {
  it('takes the currency from the pay rate rather than deriving it from the country', async () => {
    stubFetch(londonAnnual);
    const employee = await client().getEmployee('4');
    expect(employee?.currency).toBe('GBP');
  });
});

describe('country resolution', () => {
  it('returns no country when the record matches no covered jurisdiction', async () => {
    stubFetch(londonAnnual);
    const employee = await client().getEmployee('4');
    expect(employee?.country).toBeNull();
  });

  it('still resolves a Dubai location to the UAE', async () => {
    stubFetch({ ...londonAnnual, country: 'United Arab Emirates', location: 'Dubai, UAE' });
    const employee = await client().getEmployee('4');
    expect(employee?.country).toBe('AE');
  });

  it('resolves a Riyadh location to Saudi Arabia', async () => {
    stubFetch({ ...londonAnnual, country: 'Saudi Arabia', location: 'Riyadh, KSA' });
    const employee = await client().getEmployee('4');
    expect(employee?.country).toBe('SA');
  });
});
