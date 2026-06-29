# Budget Control

A privacy-first paycheck-split budgeting app. Allocate income across fixed bills, discretionary spending, reserves, and debt payoff—all in your browser, all your data stays on your device.

**[Live app →](https://www.megvais.com/budget-control/)** | [Quick start](#quick-start) | [Privacy](#privacy)

## Why it exists

Most budgeting apps sync your financial data to the cloud. Budget Control does the opposite: **all data lives in localStorage**. Your budget, transactions, and debt payoff plans never leave your device. You get full privacy *and* a fast, responsive app with zero loading states.

This is a single-file React app (~3,500 lines) built for simplicity and portability.

## Features

- **Paycheck allocation** — Split income into fixed bills, discretionary categories, emergency reserves, and debt payments
- **Reserve tracking** — See how much you've banked in each reserve over time with month-by-month history
- **Debt payoff calculator** — Auto-amortization with compounding interest; track and project payoff dates
- **CSV import/export** — Load budgets in bulk, export spending history, audit your data
- **Money flow visualization** — Interactive sankey diagram showing where your income goes each month
- **Dark/light/system theme** — Respects your OS setting; pick a preference in settings
- **PWA ready** — Install as an app on iOS/Android and desktop

## Tech stack

- **React 18** + Vite (fast bundling, HMR)
- **localStorage** (no backend, no API calls)
- **SVG** (interactive diagrams, no charting library)
- **DM Mono** (typography via Google Fonts CDN)
- **Netlify** (deployment)

## Quick start

### Local development

```bash
# Install dependencies
npm install

# Start dev server (port 5173)
npm run dev

# Build for production
npm run build
```

Then open [http://localhost:5173](http://localhost:5173).

### Deploy to Netlify

```bash
# Build locally
npm run build

# Deploy
netlify deploy --prod --dir=dist
```

Or push to GitHub and connect your repo to Netlify for continuous deployment.

## Data model

Budget Control stores everything in localStorage under three keys:

- **`budgetConfig`** — Income streams, fixed bills, discretionary categories, reserves, and debt accounts
- **`budgetData`** — Monthly spend history and reserve transactions
- **`budgetDebts`** — Debt balances and payoff schedules

On first load, the app walks you through a 7-step setup wizard to initialize your budget. You can re-run the wizard anytime to reset or import via CSV.

## Privacy

**Your data never leaves your device.** Budget Control:

- Makes no API calls (except to load Google Fonts and Material Icons)
- Stores everything in browser localStorage
- Has no backend server or database
- Does not track you or collect analytics
- Can be used completely offline (after first load)

If you clear your browser data, your budget is deleted. Export to CSV if you want a backup.

## Testing

The codebase includes regression and math audits to catch bugs early:

```bash
# 79 regression checks (structure, features, configuration integrity)
python3 regression_v8.py

# 76 math audit checks (rounding, amortization, accumulation)
python3 math_audit.py
```

Both suites run after each change to ensure correctness and compliance with hard rules (no non-ASCII chars, proper schema versioning, reserve balance consistency, etc.).

## Architecture

All code lives in [src/App.jsx](src/App.jsx). The component tree is flat:

```
Root
  SetupGate       (welcome, CSV import)
    OnboardingWizard
      WizardShell (progress bar, nav buttons)
  BudgetTracker   (main app: 6 tabs + modals)
```

**Key patterns:**
- Single source of truth: `cfg` in localStorage
- No external state library (just React hooks)
- Theme tokens loaded from `THEMES` object
- All modals rendered inline (not portals)

## Roadmap

- Wizard column headers (Bill name / Amount / Due)
- Autopay hints in bills step
- Promo APR tracking for 0% credit cards with expiry alerts
- Service worker for offline support
- Post-wizard debt management flow

## License

AGPL-3.0. In short: you can use, modify, and distribute this code freely, but if you deploy a modified version (including hosting it online), you must make your source code available under the same license. See [LICENSE](LICENSE) for full terms.

---

**Questions?** Open an issue or fork and hack. This app is designed to be readable and easy to modify.
