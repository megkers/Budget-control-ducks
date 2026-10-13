// Shapes of the data Budget Control keeps in localStorage, plus the working
// shapes built from it (wizard drafts, CSV import rows). Types only: this file
// contains no runtime code and disappears from the build.
//
// Bucket ids stay plain strings rather than a union of "bill001".."bill013".
// Every id comes from the saved config (hard rule 5), so the type should not
// pretend the set is fixed.

export type BucketId = string;

// ------------
// budgetConfig
// ------------

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface Income {
  label: string;
  // Monthly total: perPaycheck times the paychecks per month for frequency.
  netPay: number;
  // Missing on configs saved before per-paycheck entry existed.
  perPaycheck?: number;
  // Day of the month the paycheck lands.
  payday: number;
  frequency: PayFrequency;
}

export type BillCategory =
  | "Housing" | "Transportation" | "Utilities" | "Subscriptions"
  | "Health" | "Financial" | "Giving" | "Other";

export interface BucketItem {
  name: string;
  amt: number;
  // The fields below are only set on items of the fixed-bills bucket.
  // Stable id that debts link to (added in schema v3; older items lack it).
  id?: string;
  // Due day, clamped to 1..28.
  day?: number;
  // "cc" marks the credit card row, which is tracked but left out of totals.
  note?: string;
  category?: BillCategory;
}

// An item of the fixed-bills bucket as the wizard and CSV import save it.
export interface BillItem extends BucketItem {
  id: string;
  day: number;
  note: string;
  category: BillCategory;
}

export interface Bucket {
  // "bills" for the one fixed-bills bucket; "bill001" style ids otherwise.
  id: BucketId;
  label: string;
  // Monthly allocation.
  amount: number;
  color: string;
  items: BucketItem[];
}

export interface BudgetConfig {
  // Schema version, stamped by saveConfig. See runMigrations in storage.ts.
  version?: number;
  incomes: Income[];
  buckets: Bucket[];
  primaryPayday: number;
  // First month with data. setupMonth is 0-based (0 = January).
  setupYear: number;
  setupMonth: number;
}

// What loadConfig can find in storage before migrations run: any schema
// version, so any field may be missing and bucket ids may be pre-v1 names.
export type StoredConfig = Partial<BudgetConfig>;

// ------------
// budgetData
// ------------

// Pre-v4 per-month transaction record, kept only so foldLegacyTransactions can
// move it into budgetTransactions. CSV import still writes this shape.
export interface LegacyReserveTxn {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  reserveId: BucketId | null;
  category: BucketId | null;
  source: TxnSource;
  status: TxnStatus;
}

export interface MonthData {
  // Amount spent per bucket this month. Source of truth for all budget math.
  spent: Record<BucketId, number>;
  reserveTransactions?: LegacyReserveTxn[];
}

// Keyed by "<year>-<month>" with a 0-based month, e.g. "2026-0" is January.
export type BudgetData = Record<string, MonthData>;

// ------------
// budgetTransactions
// ------------

export type TxnSource = "manual" | "csv";
export type TxnStatus = "confirmed" | "ignored";

// One entry in the flat transaction ledger (see toTxnRecord in storage.ts).
export interface Transaction {
  id: string;
  // YYYY-MM-DD, or "" when unknown.
  date: string;
  amount: number;
  description: string;
  merchant: string;
  source: TxnSource;
  // Dedup hash from csvRowHash for imported rows; null for manual entries.
  sourceRef: string | null;
  bucketId: BucketId | null;
  status: TxnStatus;
  // 0..1 for rule or AI picks, 1 for a person's own choice, null when unset.
  confidence: number | null;
}

// ------------
// budgetDebts
// ------------

export type DebtType = "medical" | "auto" | "mortgage" | "student" | "credit card" | "other";

// What a debt's payment is tied to. "fixed" links to a fixed bill item by its
// id, "discretionary" to a bucket id, "manual" to nothing.
export type DebtLinkType = "fixed" | "discretionary" | "manual";

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  balance: number;
  apr: number;
  // YYYY-MM-DD the balance was last correct; interest accrues from here.
  balanceAsOf: string;
  monthly: number;
  monthlyPrincipal: number;
  escrow?: number;
  // True when the balance is going up rather than down. No payoff date is
  // calculated and the debt shows a "balance growing" tag.
  grows?: boolean;
  note: string;
  // Both are missing on debts added from the Debt edit sheet, which every
  // reader treats the same as linkedType "manual" with no link.
  linkedBucketId?: string | null;
  linkedType?: DebtLinkType;
}

// ------------
// budgetTheme
// ------------

export type ThemePref = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export interface ThemeTokens {
  bg: string; surf: string; surf2: string; bord: string;
  text1: string; text2: string; text3: string; muted: string;
  blue: string; green: string; red: string;
  blueBg: string; blueBord: string;
  redFade: string; orangeFade: string;
  greenBg: string; greenBord: string;
}

// ------------
// budgetRules (merchant memory)
// ------------

export interface MerchantRule {
  bucketId: BucketId;
  // Times this merchant was confirmed into this bucket in a row.
  count: number;
  // YYYY-MM-DD of the last confirmation.
  updatedAt: string;
}

// Keyed by normalized merchant string (see normalizeMerchant in rules.ts).
export type MerchantRules = Record<string, MerchantRule>;

export interface RuleMatch {
  bucketId: BucketId;
  pattern: string;
  // 0.9 for an exact match, 0.7 for a prefix match.
  confidence: number;
}

// ------------
// CSV import
// ------------

// parseCSVSections output for our own backup format: section name (the text
// after "## ", e.g. "INCOME", "FIXED BILLS", "META") to its rows of cells.
// The first row of each section is its header row.
export type CsvSections = Record<string, string[][]>;

// parseFlatCSV output for a bank export.
export interface FlatCsv {
  headers: string[];
  rows: string[][];
}

// Column index for each field in a bank export, or -1 when absent.
export interface CsvColumnMapping {
  date: number;
  amount: number;
  description: number;
  debit: number;
  credit: number;
}

// Whether money spent shows as a negative or positive single Amount column.
export type CsvOutflow = "negative" | "positive";

// budgetCsvMappings: remembered choices keyed by csvHeaderSignature, so the
// same bank's file maps itself next time.
export type CsvMappings = Record<string, { mapping: CsvColumnMapping; outflow: CsvOutflow }>;

// A row on the import review screen, from a bank CSV or a screenshot.
export interface ImportReviewRow {
  rowId: string;
  date: string;
  amount: number;
  description: string;
  sourceRef: string;
  bucketId: BucketId | null;
  // True when a rule or the AI filled bucketId rather than the person.
  auto: boolean;
  // True when the AI, not a merchant rule, made the suggestion.
  ai?: boolean;
  // The suggested bucket, kept so a correction can be told from acceptance.
  suggestedId: BucketId | null;
  confidence: number | null;
}

// ------------
// Wizard drafts
// ------------

// A fixed-bill row while being edited. amt and day stay strings so a
// half-typed number is not coerced; finish() parses them into a BillItem.
export interface BillDraft {
  id: string;
  name: string;
  amt: string;
  day: string;
  note: string;
  category: BillCategory;
}
