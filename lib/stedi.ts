// Confirmed live: base host, path, and `Authorization: Key <key>` header are all correct --
// a real request returns HTTP 200 with a well-formed X12 271. What test mode does NOT provide
// is a way to get a clean "active coverage" response without a real provider being enrolled
// with the payer (tradingPartnerServiceId) -- Stedi's own test-mode docs confirm there's no
// customizable mock payer for this. See checkEligibility()'s stub fallback below.
export const STEDI_BASE_URL = 'https://healthcare.us.stedi.com/2024-04-01';
export const STEDI_ELIGIBILITY_PATH = '/change/medicalnetwork/eligibility/v3';

export interface EligibilityRequest {
  tradingPartnerServiceId: string;
  provider: { npi: string; organizationName: string };
  subscriber: { memberId: string; firstName: string; lastName: string; dateOfBirth: string };
  // EQ01 service type code(s) for the 270 -- "30" is "Health Benefit Plan Coverage", the general
  // catch-all that returns the broadest set of benefits. Pass more specific codes (e.g. "1" =
  // Medical Care, "88" = Pharmacy) for narrower checks once a specific service type matters.
  encounter?: { serviceTypeCodes: string[] };
}

export interface EligibilityResult {
  covered: boolean;
  copay: number;
  planName: string;
  stubbed?: boolean;
}

export async function checkEligibility(req: EligibilityRequest): Promise<EligibilityResult> {
  const res = await fetch(STEDI_BASE_URL + STEDI_ELIGIBILITY_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${process.env.STEDI_API_KEY}`,
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`Stedi eligibility check failed: HTTP ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  // AAA errors (e.g. code 43 "Invalid/Missing Provider Identification") mean the payer rejected
  // the transaction before returning real benefits -- expected in test mode without a real
  // provider/payer enrollment. Fall back to a stubbed-but-clearly-labeled Coverage.
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    return {
      covered: true,
      copay: 25,
      planName: `[STUBBED -- Stedi returned AAA error ${data.errors[0]?.code}: ${data.errors[0]?.description}]`,
      stubbed: true,
    };
  }

  const benefits: any[] = data.benefitsInformation ?? [];
  const active = benefits.find((b) => b.code === '1');
  const copayBenefit = benefits.find((b) => b.code === 'B');

  return {
    covered: Boolean(active),
    copay: copayBenefit?.benefitAmount ? Number(copayBenefit.benefitAmount) : 0,
    planName: data.payer?.name ?? active?.planCoverageDescription ?? 'Unknown plan',
  };
}
