// Fixed values: bill template, default buckets, month names, layout flags.

// ------------
// Bill template for wizard
// ------------
export const BILL_TEMPLATE = [
{ name: "Rent / Mortgage",          amt: "", day: "", note: "",   category: "Housing" },
{ name: "HOA / Condo fees",         amt: "", day: "", note: "",   category: "Housing" },
{ name: "Home insurance",           amt: "", day: "", note: "",   category: "Housing" },
{ name: "Home maintenance fund",    amt: "", day: "", note: "",   category: "Housing" },
{ name: "Other housing bill",       amt: "", day: "", note: "",   category: "Housing" },
{ name: "Car payment",              amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Car insurance",            amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Gas & fuel",               amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Public transit / Parking", amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Other transportation bill",amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Electric / Gas / Water",   amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Internet",                 amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Phone",                    amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Other utility",            amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Streaming",                amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Music",                    amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Cloud storage",            amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "News / Magazines",         amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Other subscription",       amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Health insurance",         amt: "", day: "", note: "",   category: "Health" },
{ name: "Dental / Vision",          amt: "", day: "", note: "",   category: "Health" },
{ name: "Pet care plan",            amt: "", day: "", note: "",   category: "Health" },
{ name: "Gym / Fitness",            amt: "", day: "", note: "",   category: "Health" },
{ name: "Other health expense",     amt: "", day: "", note: "",   category: "Health" },
{ name: "Credit card payment",      amt: "", day: "", note: "cc", category: "Financial" },
{ name: "Savings transfer",         amt: "", day: "", note: "",   category: "Financial" },
{ name: "Loan / Debt payment",      amt: "", day: "", note: "",   category: "Financial" },
{ name: "Investment / Retirement",  amt: "", day: "", note: "",   category: "Financial" },
{ name: "Other financial payment",  amt: "", day: "", note: "",   category: "Financial" },
{ name: "Donations / Charity",      amt: "", day: "", note: "",   category: "Giving" },
{ name: "Political giving",         amt: "", day: "", note: "",   category: "Giving" },
{ name: "Other donation",           amt: "", day: "", note: "",   category: "Giving" },
{ name: "Childcare / School",       amt: "", day: "", note: "",   category: "Other" },
{ name: "Storage unit",             amt: "", day: "", note: "",   category: "Other" },
{ name: "Other recurring bill",     amt: "", day: "", note: "",   category: "Other" },
];
export const newBillId = () => "fb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const BLANK_BILL = () => ({ id: newBillId(), name: "", amt: "", day: "", note: "", category: "Other" });


export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Where "tell me you want this" goes. The app is static with no server and no
// analytics, so a click counter would only ever be readable on the device that
// did the clicking. A survey response is the only interest signal that can
// actually reach us, and it costs the user their own words rather than a
// tracking script that could read localStorage.
export const SURVEY_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc71ZobqLMh8TxVX6D_nbEbSuAcIaMuWMurNU_SpLZzmRz8eg/viewform?usp=header";

// Overview card layout switcher. Flip this constant to try alternate arrangements.
//   "A" - original: single KPI row, full-width discretionary bar below
//   "B" - Monthly Income + Discretionary Budget Used share a taller row with larger visualizations
export const OVERVIEW_LAYOUT = "B";

// Fallback constants used only before first wizard run
export const NET_PAY = 0;
export const PAYDAY = 1;

export const BUCKETS = [
{
id: "bills", label: "Fixed Bills", amount: 2100, color: "#4A9EFF",
items: [
{ name: "Rent / Mortgage",     amt: 1500, day: 1  },
{ name: "Car payment",         amt: 300,  day: 5  },
{ name: "Car insurance",       amt: 100,  day: 5  },
{ name: "Phone",               amt: 60,   day: 10 },
{ name: "Internet",            amt: 60,   day: 10 },
{ name: "Health insurance",    amt: 80,   day: 15 },
{ name: "Credit card payment", amt: 0,    day: 20, note: "cc" },
],
},
{ id: "bill001",        label: "Meal Kits / Delivery",   amount: 0,   color: "#E879F9", items: [{ name: "Meal kits", amt: 0 }] },
{ id: "bill002",     label: "Groceries",              amount: 400, color: "#FFB347", items: [{ name: "Groceries", amt: 400 }] },
{ id: "bill003",        label: "Dining Out",             amount: 200, color: "#FCD34D", items: [{ name: "Dining out", amt: 200 }] },
{ id: "bill004", label: "Entertainment",          amount: 200, color: "#FB923C", items: [{ name: "Entertainment", amt: 200 }] },
{ id: "bill005",      label: "Gas & Fuel",             amount: 100, color: "#FDE68A", items: [{ name: "Gas & fuel", amt: 100 }] },
{ id: "bill006",      label: "Clothing Reserve",       amount: 100, color: "#F97316", items: [{ name: "Monthly contribution", amt: 100 }] },
{ id: "bill007",         label: "Gifts Reserve",          amount: 100, color: "#FDBA74", items: [{ name: "Monthly contribution", amt: 100 }] },
{ id: "bill008",        label: "Travel Reserve",         amount: 200, color: "#7ED4A0", items: [{ name: "Monthly contribution", amt: 200 }] },
{ id: "bill009", label: "Pet Reserve",            amount: 100, color: "#F9A8D4", items: [{ name: "Grooming & vet", amt: 100 }] },
{ id: "bill010",  label: "Home Upkeep",            amount: 100, color: "#60A5FA", items: [{ name: "Home maintenance", amt: 100 }] },
{ id: "bill011",       label: "General Savings",        amount: 200, color: "#B8A9FF", items: [{ name: "Savings transfer", amt: 200 }] },
{ id: "bill012",label: "Beauty Reserve",         amount: 100, color: "#C084FC", items: [{ name: "Hair, nails & beauty", amt: 100 }] },
{ id: "bill013",label: "Other Reserve",          amount: 0,   color: "#34D399", items: [{ name: "Other reserve", amt: 0 }] },
];
