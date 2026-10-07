// A provider outage is not evidence that a research hypothesis failed.
export function isProviderQuotaError(error) {
  return /(?:hit|reached|exceeded) (?:your |the )?usage limit|usage limit reached|rate limit reached|out of extra usage/i.test(String(error));
}
