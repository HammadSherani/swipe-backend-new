/**
 * Loose token-overlap match between two names — avoids false rejections from
 * spacing/initials/ordering differences while still catching a genuinely
 * different person/account holder. Used to compare user-submitted names
 * against provider-verified records (BVN, NIN, bank account name enquiry).
 */
export function namesLooselyMatch(submitted: string, verified: string): boolean {
  const normalize = (s: string) =>
    s.toUpperCase().replace(/[^A-Z\s]/g, '').split(/\s+/).filter(Boolean);

  const submittedTokens = normalize(submitted);
  const verifiedTokens = new Set(normalize(verified));

  if (submittedTokens.length === 0) return false;

  const overlap = submittedTokens.filter((t) => verifiedTokens.has(t)).length;
  return overlap >= Math.ceil(submittedTokens.length / 2);
}
