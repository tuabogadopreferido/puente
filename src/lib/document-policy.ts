export const documentTypes = [
  "tax_status",
  "tax_compliance",
  "incorporation",
  "power_of_attorney",
  "bank_cover",
  "proof_of_address",
  "repse",
  "representative_id",
  "balance_sheet",
  "income_statement",
  "tax_return",
  "other",
] as const;

const onboardingTypes = new Set<string>(documentTypes.slice(0, 8));
const financialTypes = new Set<string>([
  "balance_sheet",
  "income_statement",
  "tax_return",
]);

/** Product policy: supplier onboarding is routine; company financials always require review. */
export function normalizeSensitivity(
  documentType: string,
  requested: boolean,
): boolean {
  if (onboardingTypes.has(documentType)) return false;
  if (financialTypes.has(documentType)) return true;
  return requested;
}
