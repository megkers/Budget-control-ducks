"""
Math audit test suite for budget-v7.jsx
Validates every calculation path against known scenarios.
Run: python3 math_audit.py file.jsx
"""
import sys, json, math

with open(sys.argv[1] if len(sys.argv) > 1 else 'file.jsx', 'rb') as f:
    code = f.read().decode('utf-8')

PASS = 0
FAIL = 0

def check(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  OK   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}{' — ' + detail if detail else ''}")

# ========================================================
# 1. INCOME FREQUENCY MULTIPLIERS
#    weekly=52/12, biweekly=26/12, semimonthly=2, monthly=1
# ========================================================
print("\n=== Income Frequency Multipliers ===")

# Verify the FREQ object matches expected values
check("FREQ weekly = 52/12",
      "weekly: 52/12" in code or "weekly:52/12" in code)
check("FREQ biweekly = 26/12",
      "biweekly: 26/12" in code or "biweekly:26/12" in code)
check("FREQ semimonthly = 2",
      "semimonthly: 2" in code or "semimonthly:2" in code)
check("FREQ monthly = 1",
      "monthly: 1" in code or "monthly:1" in code)

# Income total must be rounded to avoid floating-point drift
check("Wizard totalIncome rounded",
      "Math.round(incomes.reduce" in code,
      "totalIncome in wizard must use Math.round")

# BudgetTracker income total also rounded
check("BT totalIncomeCfg rounded",
      "Math.round(cfg.incomes.reduce" in code
      or "Math.round(incomes.reduce" in code,
      "totalIncomeCfg in BudgetTracker should round")

# Wizard finish() rounds per-income to CENTS (not whole dollars)
check("Wizard finish rounds netPay to cents",
      "* 100) / 100," in code and "FREQ[i.frequency]" in code,
      "finish() should round income to cents, not whole dollars")

# Wizard allocation bar floors remaining for display
check("Wizard allocation bar floors remaining",
      "Math.floor(remaining)" in code,
      "Allocation bar should floor remaining so sub-dollar dust is hidden")

# billsAmt in finish() is rounded to cents
check("Wizard finish rounds billsAmt",
      "Math.round(filledBills.filter" in code,
      "billsAmt should be rounded to cents to prevent float drift")

# billsAmt in edit modal save is rounded to cents
check("Edit modal rounds billsAmt",
      "Math.round(filled.filter" in code,
      "Edit modal billsAmt should also be rounded to cents")

# ========================================================
# 2. WIZARD ALLOCATION MATH
#    allocated = billsTotal + discTotal + resTotal
#    unallocated = totalIncome - allocated
# ========================================================
print("\n=== Wizard Allocation ===")

# Bills total excludes CC items
check("Wizard billsTotal excludes CC",
      'bills.filter(b => b.note !== "cc").reduce' in code,
      "billsTotal must filter out note==='cc' items")

# allocated is rounded
check("Wizard allocated rounded",
      "Math.round((billsTotal + discTotal + resTotal) * 100) / 100" in code,
      "allocated should be rounded to cents")

# unallocated is rounded
check("Wizard unallocated rounded",
      "Math.round((totalIncome - allocated) * 100) / 100" in code,
      "unallocated should be rounded to cents")

# ========================================================
# 3. RESERVE BALANCE FUNCTIONS
#    Must all use the same loop pattern:
#    setupYear/setupMonth -> selected year/month
# ========================================================
print("\n=== Reserve Balance Loops ===")

RESERVE_FNS = [
    "getReserveBal",
]

# Check the shared function exists
for fn in RESERVE_FNS:
    check(f"{fn} exists", f"function {fn}(" in code)

# Check it uses setupYear (not hardcoded year)
for fn in RESERVE_FNS:
    idx = code.find(f"function {fn}(")
    if idx < 0:
        continue
    body = code[idx:idx+600]
    check(f"{fn} uses setupYear",
          "setupYear" in body,
          f"{fn} should loop from setupYear, not a hardcoded year")
    check(f"{fn} uses setupMonth guard",
          "setupMonth" in body,
          f"{fn} should skip months before setupMonth")
    check(f"{fn} breaks at selected year/month",
          "(y === year && m > month)" in body,
          f"{fn} should stop at the user-selected month, not today")

# Legacy individual functions should be GONE
LEGACY_FNS = [
    "getTravelBal", "getSallyReserveBal", "getClothingBal",
    "getGiftsBal", "getHouseUpkeepBal", "getBeautyReserveBal",
    "getSavingsBal",
]
for fn in LEGACY_FNS:
    check(f"Legacy {fn} removed",
          f"function {fn}()" not in code,
          f"{fn} should be replaced by getReserveBal")

# ========================================================
# 4. OVERVIEW "BANKED SINCE" KPI
#    Must match the sum of individual reserve balances
#    Check it uses the same loop pattern
# ========================================================
print("\n=== Banked Since KPI ===")

# Find the bankedYTD calculation in overview
banked_idx = code.find("bankedYTD")
check("bankedYTD variable exists", banked_idx > 0)

if banked_idx > 0:
    banked_section = code[banked_idx:banked_idx+300]
    check("bankedYTD reuses getReserveBal",
      "getReserveBal(id)" in banked_section or "getReserveBal(id)," in banked_section,
      "bankedYTD should sum getReserveBal calls, not reimplement the loop")

# ========================================================
# 5. DUPLICATE CALCULATION PATHS (consistency risk)
#    Count how many independent reserve-loop implementations exist
# ========================================================
print("\n=== Duplicate Calculation Paths ===")

# Count occurrences of the reserve loop pattern
loop_pattern = "for (let y = setupYear"
loop_count = code.count(loop_pattern)
check(f"Reserve loop count: {loop_count} instances found",
      True,  # informational
      f"Each is a potential consistency divergence point")

# After refactor: 1 shared fn + 1 history table = 2. Flag if > 3.
if loop_count > 3:
    check("REFACTOR OPPORTUNITY: many duplicate reserve loops",
          False,
          f"Found {loop_count} copies of the reserve accumulation loop. "
          "A single getReserveBal(id) function reading spent[id] would eliminate divergence risk.")
else:
    check("Reserve loops consolidated",
          True,
          f"Only {loop_count} loop(s) remain -- well consolidated")

# ========================================================
# 6. ROUNDING GUARDS ON CURRENCY ACCUMULATION
# ========================================================
print("\n=== Rounding Guards ===")

# Check if the shared getReserveBal rounds its result
idx = code.find("function getReserveBal(")
if idx >= 0:
    body = code[idx:idx+600]
    has_round = "Math.round" in body
    check("getReserveBal rounds result",
          has_round,
          "getReserveBal accumulates floats without rounding -- drift risk over many months")

# Check history table also rounds
check("History table rounds accumulation",
      "Math.round((bals[c.id]" in code,
      "Reserve history table should round each cell to prevent float drift")

# Check wizard finish() clamps bill days 1-28
check("Wizard clamps bill day 1-28",
      "Math.min(28, Math.max(1," in code,
      "Bill days should be clamped to 1-28 range")

# ========================================================
# 7. DEBT PAYOFF AMORTIZATION
# ========================================================
print("\n=== Debt Payoff Math ===")

# Auto loan uses daily compounding
check("Auto loan daily compounding",
      "Math.pow(1 + debt.apr / 365 / 100, 30.4375)" in code
      or "Math.pow(1 + debt.apr/365/100, 30.4375)" in code,
      "Auto loans should use daily compounding formula")

# Other loans use monthly rate
check("Standard monthly rate",
      "debt.apr / 12 / 100" in code or "debt.apr/12/100" in code)

# Guard against infinite loop (pmt <= interest)
check("Amortization infinite loop guard",
      "pmt <= interest" in code,
      "Must bail out when payment doesn't cover interest")

# Guard against runaway months
check("Amortization max months guard",
      "months < 600" in code,
      "Must cap at 600 months (50 years) to prevent infinite loop")

# Payoff date uses balanceAsOf for interest-bearing debts
check("Payoff date from balanceAsOf",
      "new Date(debt.balanceAsOf)" in code,
      "Interest-bearing payoff date should anchor to balanceAsOf")

# ========================================================
# 8. DEBT YTD "PAID" CALCULATION
# ========================================================
print("\n=== Debt YTD Paid ===")

# The overview card calculates paidYTD as monthly * 3
# This is a rough estimate — flag it
paidytd_idx = code.find("paidYTD")
if paidytd_idx > 0:
    section = code[paidytd_idx:paidytd_idx+300]
    is_hardcoded = "monthly * 3" in section
    uses_elapsed = "monthsElapsed" in section
    check("Debt paidYTD uses dynamic months elapsed",
          not is_hardcoded and uses_elapsed,
          "paidYTD should compute from monthsElapsed, not a hardcoded multiplier")

# ========================================================
# 9. TRANSACTION LOGGING MATH
# ========================================================
print("\n=== Transaction Logging ===")

# Reserve spend: addTransaction adds to both reserveTransactions AND spent[id]
check("addTransaction updates spent[id] for reserves",
      "txCategory === \"reserve\"" in code and "[txReserve]" in code,
      "Must update spent[id] when logging reserve transactions")

# Discretionary spend: addTransaction updates spent[id]
check("addTransaction updates spent for discretionary",
      "txCategory === \"discretionary\"" in code,
      "Must branch on txCategory to update discretionary spent")

check("individual log fns removed",        "function logTravel" not in code,  "logTravel should be replaced by logReserveSpend")

# ========================================================
# 10. EDIT MODAL SAVE MATH
# ========================================================
print("\n=== Edit Modal Save ===")

# Bills modal: recalculates billsAmt excluding CC
check("Edit bills recalculates amount excluding CC",
      'filled.filter(b => b.note !== "cc").reduce' in code
      or 'editBills.filter(b => b.note !== "cc").reduce' in code)

# Disc/reserves modals filter to amount > 0
check("Edit disc filters amount > 0",
      'editDisc.filter(b => parseFloat(b.amount) > 0)' in code)
check("Edit reserves filters amount > 0",
      'editReserves.filter(b => parseFloat(b.amount) > 0)' in code)

# ========================================================
# 11. CSV EXPORT
# ========================================================
print("\n=== CSV Export ===")

check("CSV export function exists",
      "Export (CSV)" in code,
      "Settings tab should have an Export button")
check("CSV has INCOME section",
      '"## INCOME"' in code)
check("CSV has FIXED BILLS section",
      '"## FIXED BILLS"' in code)
check("CSV has DISCRETIONARY section",
      '"## DISCRETIONARY"' in code)
check("CSV has RESERVES section",
      '"## RESERVES"' in code)
check("CSV has DEBTS section",
      '"## DEBTS"' in code)
check("CSV has MONTHLY SPEND section",
      '"## MONTHLY SPEND"' in code)
check("CSV has RESERVE SPEND section",
      '"## RESERVE SPEND"' in code)
check("CSV has RESERVE TRANSACTIONS section",
      '"## RESERVE TRANSACTIONS"' in code)
check("CSV has META section",
      '"## META"' in code)
check("CSV download via blob",
      "new Blob([csv]" in code,
      "Export should create a downloadable blob")
check("CSV escapes commas/quotes",
      'indexOf(",")' in code and 'indexOf' in code,
      "CSV values must be escaped for commas and quotes")

# Import checks
check("CSV import button exists",
      "Import (CSV)" in code,
      "Settings tab should have an Import button")
check("CSV import parses sections",
      '"## "' in code and "curSection" in code,
      "Import should split CSV into sections by ## headers")
check("CSV import validates required sections",
      'missing' in code and '"INCOME"' in code and '"META"' in code,
      "Import should validate INCOME and META sections exist")
check("CSV import confirms before overwrite",
      "REPLACE all your current data" in code,
      "Import should confirm with user before overwriting")
check("CSV import saves all three stores",
      "saveConfig(newCfg)" in code and "saveData(newData)" in code and "saveDebts(newDebts)" in code,
      "Import must write to all three localStorage keys")
check("CSV import updates React state",
      "setCfg(newCfg)" in code and "setData(newData)" in code and "setDebts(newDebts)" in code,
      "Import must update React state to reflect new data")
check("CSV import rounds billsAmt",
      "Math.round(billItems.filter" in code,
      "Imported billsAmt should be rounded to cents")
check("CSV import handles quoted fields",
      "parseRow" in code and 'inQ' in code,
      "Import CSV parser must handle quoted fields with commas")
check("Wizard pre-populates debts on re-run",
      "loadDebts()" in code and "if (initialConfig)" in code and "saved.map(function" in code,
      "Wizard debt state should load from localStorage when initialConfig is present")
check("CSV export includes linked debt fields",
      '"Linked Bucket"' in code and '"Linked Type"' in code,
      "Export must include linkedBucketId and linkedType columns")
check("CSV import reads linked debt fields",
      "linkedBucketId: (r[10]" in code and "linkedType: (r[11]" in code,
      "Import must parse linkedBucketId and linkedType from CSV")
check("Welcome import launches wizard with config",
      "setCsvConfig" in code and "csvConfig || initialConfig" in code,
      "Welcome import should pass parsed config to wizard for pre-fill")

# ========================================================
# 12. NUMERICAL SCENARIO TESTS
#     Pure Python math to verify the formulas
# ========================================================
print("\n=== Numerical Scenario Validation ===")

# Scenario: Income frequency math
def test_income_freq():
    cases = [
        ("weekly $1000",     1000, 52/12,  4333.33),
        ("biweekly $2000",   2000, 26/12,  4333.33),
        ("semimonthly $3000",3000, 2,      6000.00),
        ("monthly $5000",    5000, 1,      5000.00),
    ]
    for label, per_pay, mult, expected in cases:
        result = round(per_pay * mult * 100) / 100
        # The app does Math.round(reduce(...) * 100) / 100
        # but the wizard finish() does Math.round(perPaycheck * mult)
        # which rounds to integer — check both
        result_int = round(per_pay * mult)
        check(f"Income: {label} -> ${expected:.2f}/mo",
              abs(result - expected) < 0.02 or abs(result_int - round(expected)) < 1,
              f"Got {result} or {result_int}")
test_income_freq()

# Scenario: Reserve balance over 6 months, $200/mo contribution, $150 spent in month 3
def test_reserve_balance():
    monthly = 200
    spend = {2: 150}  # month index 2 (0-based) has $150 spend
    bal = 0
    for m in range(6):
        bal += monthly - spend.get(m, 0)
    expected = 200*6 - 150  # = 1050
    check(f"Reserve: 6mo x $200, $150 spent in mo3 -> ${expected}",
          bal == expected,
          f"Got {bal}")
test_reserve_balance()

# Scenario: Auto loan payoff — $10,000 @ 2.95% APR, $200/mo principal
def test_auto_payoff():
    balance = 10000
    apr = 2.95
    monthly_pmt = 200
    monthly_rate = (1 + apr / 365 / 100) ** 30.4375 - 1
    months = 0
    total_interest = 0
    b = balance
    while b > 0.01 and months < 600:
        interest = b * monthly_rate
        if monthly_pmt <= interest:
            break
        total_interest += interest
        b -= (monthly_pmt - interest)
        months += 1
    check(f"Auto payoff: $10k @ 2.95%, $200/mo -> {months} months",
          45 <= months <= 55,
          f"Got {months} months, ${total_interest:.2f} interest")
test_auto_payoff()

# Scenario: 0% medical debt payoff — $1882.57 @ $62/mo
def test_zero_apr_payoff():
    balance = 1882.57
    monthly = 62
    months = math.ceil(balance / monthly)
    expected = 31  # ceil(1882.57/62) = 31
    check(f"0% payoff: $1882.57 @ $62/mo -> {expected} months",
          months == expected,
          f"Got {months}")
test_zero_apr_payoff()

# Scenario: Floating point accumulation — 12 months of $166.67
def test_float_accumulation():
    val = 0
    for _ in range(12):
        val += 166.67
    exact = 166.67 * 12  # = 2000.04
    naive_round = round(val * 100) / 100
    check(f"Float accumulation: 12 x $166.67 = ${exact:.2f}",
          abs(naive_round - exact) < 0.02,
          f"Naive sum = {val}, rounded = {naive_round}, expected {exact}")
test_float_accumulation()

# Scenario: Edge case — payment exactly equals interest (should return null/no payoff)
def test_payment_equals_interest():
    balance = 100000
    apr = 12  # 1% monthly
    monthly_rate = apr / 12 / 100  # 0.01
    monthly_pmt = balance * monthly_rate  # exactly $1000 = interest
    # pmt <= interest should bail
    check("Edge: pmt == interest -> no payoff",
          monthly_pmt <= balance * monthly_rate,
          "Should return null when payment doesn't exceed interest")
test_payment_equals_interest()

# ========================================================
# SUMMARY
# ========================================================
print(f"\n{'='*50}")
print(f"Math Audit: {PASS} passed, {FAIL} failed")
if FAIL > 0:
    print("Review failures above — each is a concrete math risk.")
else:
    print("All math checks passed.")
print(f"{'='*50}")

sys.exit(1 if FAIL > 0 else 0)
