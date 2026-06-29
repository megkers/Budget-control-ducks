with open('file.jsx','rb') as f:
    b = f.read()
code = b.decode('utf-8')
checks = [
    # -- Babel / ASCII safety --
    ('Non-ASCII bytes',              sum(1 for x in b if x > 127) == 0),
    ('Uses ?. optional chaining',    '?.' in code),
    ('Uses ?? nullish coalescing',   '??' in code),
    ('No obj-literal dot pattern',   '|| {items:[]}).items' not in code),
    ('No template-fn in JSX',        'autopay ${ordinal' not in code),
    # -- Legacy hardcodes removed --
    ('No NEPHEW_SAVINGS_RATE',       'NEPHEW_SAVINGS_RATE' not in code),
    ('No getNephewSavingsBal',       'getNephewSavingsBal' not in code),
    ('No INITIAL_DEBTS',             'INITIAL_DEBTS' not in code),
    ('No NEPHEW_STARTS',             'NEPHEW_STARTS' not in code),
    ('No hardcoded 2026 loops',      'for (let y = 2026' not in code),
    ('No hardcoded amounts dict',    '"clothing":220' not in code),
    ('No IL protected',              'IL protected' not in code),
    ('No mortgage id hardcode',      'd.id==="mortgage"' not in code),
    ('No DebtDetail JSX tag',        '<DebtDetail' not in code),
    # -- NaN / edge case guards --
    ('NaN debt fix',                 'loadDebts() || []' in code),
    ('NaN paidPct fix',              'denom > 0 ? Math.round' in code),
    ('Debt card hidden when empty',  'debts.length > 0 ? (' in code),
    ('Debt tab empty state',         'No debts added yet' in code),
    # -- Zero-amount filtering --
    ('Zero filter reserves',         'reserveIds.includes(b.id) && b.amount > 0' in code),
    ('Zero filter disc tab',         'discIds.includes(b.id) && b.amount > 0' in code),
    ('Zero filter fixed tab',        'filter(i => i.amt > 0 || i.note === "cc")' in code),
    ('Zero filter search',           'b.id !== "bills" && b.amount > 0' in code),
    ('All 6 debt type colors',       'credit card' in code and 'student' in code),
    # -- localStorage / state --
    ('localStorage data',            'saveData(data)' in code),
    ('localStorage debts',           'saveDebts(debts)' in code),
    ('cfg state',                    'const [cfg, setCfg] = useState' in code),
    ('totalIncome rounded',          'Math.round(incomes.reduce' in code),
    # -- Wizard --
    ('Wizard pre-pop',               'initialConfig' in code),
    ('setupYear in wizard',          'setupYear:  existingCfg.setupYear' in code),
    ('setupYear in BT',              'cfg?.setupYear' in code),
    ('WizardShell at module level',  code.index('function WizardShell') < code.index('function OnboardingWizard')),
    ('cfgVersion remounts BT',       'key={cfgVersion}' in code and 'setCfgVersion' in code),
    # -- Settings / UI --
    ('Settings tab',                 'Edit Budget Setup' in code),
    ('modals inside return tree',    code.rindex('editModal === "debt"') < code.rindex('  );\n}')),
    ('cs.body centered',             'margin: "0 auto"' in code),
    ('cs.body wider',                '1100px' in code),
    ('Overview KPI auto-fit',        'repeat(auto-fit, minmax(180px, 1fr))' in code),
    # -- v8: Math integrity --
    ('Shared getReserveBal',         'function getReserveBal(' in code),
    ('Legacy getTravelBal removed',  'function getTravelBal()' not in code),
    ('Legacy getSavingsBal removed', 'function getSavingsBal()' not in code),
    ('Reserve spend uses spent[id]',  'spent[id]' in code or 'spent[c.id]' in code),
    ('bankedYTD uses getReserveBal', 'getReserveBal(id)' in code),
    ('History cols dynamic',         'ALL_HIST_COLS' in code),
    ('Banked label dynamic',         '"Banked Since "' in code),
    ('Debt groups from typeLabel',   'Object.keys(typeLabel).filter' in code),
    ('paidYTD uses monthsElapsed',   'monthsElapsed' in code and 'monthly * 3' not in code),
    # -- v8: Rounding --
    ('getReserveBal rounds',         'Math.round(bal * 100) / 100' in code),
    ('History table rounds',         'Math.round((bals[c.id]' in code),
    ('Income stored cents',          '* 100) / 100,' in code and 'FREQ[i.frequency]' in code),
    ('Allocation bar floors',        'Math.floor(remaining)' in code),
    ('billsAmt rounded wizard',      'Math.round(filledBills.filter' in code),
    ('billsAmt rounded edit modal',  'Math.round(filled.filter' in code),
    # -- v8: CSV export/import --
    ('CSV export button',            'Export (CSV)' in code),
    ('CSV import button settings',   'Import (CSV)' in code),
    ('CSV section INCOME',           '"## INCOME"' in code),
    ('CSV section DEBTS',            '"## DEBTS"' in code),
    ('CSV section META',             '"## META"' in code),
    ('CSV blob download',            'new Blob([csv]' in code),
    ('CSV escapes commas',           'indexOf(",")' in code),
    ('CSV import validates',         'REPLACE all your current data' in code),
    ('CSV import parses sections',   'curSection' in code),
    ('CSV linked debt fields',       '"Linked Bucket"' in code and '"Linked Type"' in code),
    # -- v8: Welcome screen --
    ('Welcome CSV import',           'Import from CSV' in code),
    ('Welcome import to wizard',     'csvConfig || initialConfig' in code),
    ('Demo data button',             'view the demo' in code),
    ('Demo saves all stores',        'saveConfig(demoCfg)' in code and 'saveData(demoData)' in code),
    # -- v8: Income edit modal --
    ('Income edit modal',            'renderEditIncome' in code),
    ('Income modal in render tree',  'editModal === "income"' in code),
    ('editIncomes state',            'editIncomes, setEditIncomes' in code),
    # -- v8: How budgets work step --
    ('howbudgets step exists',       '"howbudgets"' in code),
    ('howbudgets in STEPS array',    '"income", "howbudgets", "bills"' in code),
    ('Allocation bar hidden step 1', 'stepIdx >= 2' in code),
    # -- v8: Wizard debt persistence --
    ('Wizard loads saved debts',     'loadDebts()' in code and 'initialConfig' in code),
    # -- v8: Date inputs left-aligned --
    ('Date inputs left-aligned',     'textAlign: "left"' in code),
    # -- schema versioning --
    ('SCHEMA_VERSION constant',      'SCHEMA_VERSION = 2' in code),
    ('ID_RENAMES map',               'ID_RENAMES' in code and 'bill001' in code),
    ('runMigrations function',       'function runMigrations(' in code),
    ('loadConfig calls runMigrations', 'runMigrations(cfg)' in code),
    ('saveConfig stamps version',    'version: SCHEMA_VERSION' in code),
]
for name, result in checks:
    print('OK  ' if result else 'FAIL', name)
print(f'\n{sum(1 for _,r in checks if r)}/{len(checks)} passed')
