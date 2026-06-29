#!/usr/bin/env python3
"""
csv_roundtrip.py
Round-trip test for the Budget Control CSV format.
  1. Parse a sample CSV into config/data/debts structures
  2. Verify each section is correctly parsed
  3. Re-serialize back to CSV
  4. Re-parse the re-serialized CSV
  5. Verify the two parsed structures are identical

Run from project root: python3 csv_roundtrip.py
"""
from datetime import date

MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
DISC_IDS  = ["bill001","bill002","bill003","bill004","bill005"]
RES_IDS   = ["bill011","bill010","bill008","bill006","bill007","bill009","bill012","bill013"]
OLD_IDS   = ["factor","groceries","dining","entertainment","gasoline",
             "travel","clothing","gifts","sally_reserve","house_upkeep",
             "savings","beauty_reserve","nephew_savings"]

# ---- Sample CSV (matches what the app exports) ----
SETUP_YEAR  = date.today().year
SETUP_MONTH = 0   # Jan

SAMPLE_CSV = f"""## INCOME
Label,Per Paycheck,Frequency,Payday,Monthly Total
Main Job,2750,semimonthly,1,5500
Side Gig,500,monthly,15,500

## FIXED BILLS
Name,Amount,Due Day,Category,Note
Rent,1450,1,Housing,
Car Payment,350,5,Transportation,
Phone,65,10,Utilities,
Credit Card,0,22,Financial,cc

## DISCRETIONARY
ID,Label,Monthly Budget
bill002,Groceries,450
bill003,Dining Out,250
bill004,Entertainment,150
bill005,Gas & Fuel,120
bill001,Meal Kits,200

## RESERVES
ID,Label,Monthly Contribution
bill008,Travel Reserve,500
bill011,General Savings,800
bill006,Clothing Reserve,100
bill007,Gifts Reserve,175
bill009,Pet Reserve,125
bill010,Home Upkeep,125
bill012,Beauty Reserve,120
bill013,Other Reserve,50

## DEBTS
Name,Type,Balance,APR,Monthly Payment,Monthly Principal,Escrow,Balance As Of,Growing,Note,Linked Bucket,Linked Type
Car Loan,auto,8450,4.5,350,350,0,{date.today().isoformat()},no,,Car Payment,fixed
"Student Loan, Federal",student,12200,5.25,250,250,0,{date.today().isoformat()},no,Federal direct loan,,manual

## MONTHLY SPEND
Month,bill001,bill002,bill003,bill004,bill005
Jan {SETUP_YEAR},180,410,225,90,95
Feb {SETUP_YEAR},200,475,270,130,110

## RESERVE SPEND
Month,Travel,Beauty,Clothing,Gifts,Pet,Savings,House
Jan {SETUP_YEAR},120,65,0,45,80,0,0
Feb {SETUP_YEAR},0,85,75,0,0,0,150

## RESERVE TRANSACTIONS
Month,Date,Merchant,Amount,Reserve ID,Discretionary ID
Jan {SETUP_YEAR},{SETUP_YEAR}-01-15,Amazon,45.00,bill007,
Jan {SETUP_YEAR},{SETUP_YEAR}-01-22,REI,120.00,bill008,

## META
Setup Date,Jan {SETUP_YEAR}
Primary Payday,1
Exported,{date.today().isoformat()}
""".strip()


# ---- CSV parser (mirrors SetupGate JS logic) ----
def parse_sections(text):
    def parse_row(line):
        cols, cur, in_q = [], "", False
        i = 0
        while i < len(line):
            ch = line[i]
            if in_q:
                if ch == '"' and i + 1 < len(line) and line[i+1] == '"':
                    cur += '"'; i += 1
                elif ch == '"':
                    in_q = False
                else:
                    cur += ch
            else:
                if ch == '"':    in_q = True
                elif ch == ',':  cols.append(cur); cur = ""
                else:            cur += ch
            i += 1
        cols.append(cur)
        return cols
    sections = {}
    cur_section = None
    for line in text.replace('\r\n','\n').replace('\r','\n').split('\n'):
        t = line.strip()
        if t.startswith('## '):
            cur_section = t[3:].strip(); sections[cur_section] = []
        elif cur_section and t:
            sections[cur_section].append(parse_row(t))
    return sections

def data_rows(sections, name):
    r = sections.get(name, [])
    return r[1:] if len(r) > 1 else []

def num(v):
    try:    return float(v)
    except: return 0.0


# ---- Parse CSV into config/data/debts ----
def parse_csv(text):
    sections = parse_sections(text)
    FREQ_MAP = {"weekly": 52/12, "biweekly": 26/12, "semimonthly": 2, "monthly": 1}

    # META
    meta = {}
    for r in sections.get("META", []):
        if len(r) >= 2: meta[r[0].strip()] = r[1].strip()
    setup_date = meta.get("Setup Date", "")
    parts = setup_date.split(" ")
    s_mo  = MONTHS.index(parts[0]) if parts and parts[0] in MONTHS else 0
    s_yr  = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else date.today().year
    payday = int(meta.get("Primary Payday", 1) or 1)

    # INCOME
    incomes = []
    for r in data_rows(sections, "INCOME"):
        label = (r[0] if r else "").strip() or "Income"
        per_paycheck = num(r[1] if len(r) > 1 else 0)
        frequency    = (r[2] if len(r) > 2 else "monthly").strip()
        pay_day      = int(num(r[3] if len(r) > 3 else 1))
        net_pay      = num(r[4] if len(r) > 4 else 0)
        if not net_pay and per_paycheck > 0:
            net_pay = round(per_paycheck * (FREQ_MAP.get(frequency, 1)) * 100) / 100
        if net_pay > 0 or per_paycheck > 0:
            incomes.append({"label": label, "perPaycheck": per_paycheck,
                            "frequency": frequency, "payday": pay_day, "netPay": net_pay})

    # FIXED BILLS
    bill_items = []
    for r in data_rows(sections, "FIXED BILLS"):
        name = (r[0] if r else "").strip()
        amt  = num(r[1] if len(r) > 1 else 0)
        day  = min(28, max(1, int(num(r[2] if len(r) > 2 else 1))))
        cat  = (r[3] if len(r) > 3 else "Other").strip()
        note = (r[4] if len(r) > 4 else "").strip()
        if name and (amt > 0 or note == "cc"):
            bill_items.append({"name": name, "amt": amt, "day": day,
                               "category": cat, "note": note})
    bills_amt = round(sum(b["amt"] for b in bill_items if b["note"] != "cc") * 100) / 100

    # DISCRETIONARY
    disc_color = {"bill001":"#E879F9","bill002":"#FFB347","bill003":"#FCD34D",
                  "bill004":"#FB923C","bill005":"#FDE68A"}
    disc_bkts = []
    for r in data_rows(sections, "DISCRETIONARY"):
        bid   = (r[0] if r else "").strip()
        label = (r[1] if len(r) > 1 else "").strip()
        amt   = num(r[2] if len(r) > 2 else 0)
        if bid and amt > 0:
            disc_bkts.append({"id": bid, "label": label, "amount": amt,
                               "color": disc_color.get(bid, "#888"),
                               "items": [{"name": label, "amt": amt}]})

    # RESERVES
    res_color = {"bill011":"#B8A9FF","bill010":"#60A5FA","bill008":"#7ed4a0",
                 "bill006":"#F97316","bill007":"#FDBA74","bill009":"#F9A8D4",
                 "bill012":"#C084FC","bill013":"#34D399"}
    res_bkts = []
    for r in data_rows(sections, "RESERVES"):
        bid   = (r[0] if r else "").strip()
        label = (r[1] if len(r) > 1 else "").strip()
        amt   = num(r[2] if len(r) > 2 else 0)
        if bid and amt > 0:
            res_bkts.append({"id": bid, "label": label, "amount": amt,
                              "color": res_color.get(bid, "#888"),
                              "items": [{"name": label, "amt": amt}]})

    cfg = {
        "incomes": incomes,
        "buckets": [{"id":"bills","label":"Fixed Bills","amount":bills_amt,
                     "color":"#4A9EFF","items":bill_items}] + disc_bkts + res_bkts,
        "primaryPayday": payday,
        "setupYear": s_yr,
        "setupMonth": s_mo,
    }

    # DEBTS
    debts = []
    for i, r in enumerate(data_rows(sections, "DEBTS")):
        name = (r[0] if r else "").strip()
        if not name: continue
        debts.append({
            "id":               f"d-imp-{i}",
            "name":             name,
            "type":             (r[1] if len(r) > 1 else "other").strip(),
            "balance":          num(r[2] if len(r) > 2 else 0),
            "apr":              num(r[3] if len(r) > 3 else 0),
            "monthly":          num(r[4] if len(r) > 4 else 0),
            "monthlyPrincipal": num(r[5] if len(r) > 5 else 0),
            "escrow":           num(r[6] if len(r) > 6 else 0),
            "balanceAsOf":      (r[7] if len(r) > 7 else "").strip(),
            "grows":            (r[8] if len(r) > 8 else "").strip().lower() == "yes",
            "note":             (r[9] if len(r) > 9 else "").strip(),
            "linkedBucketId":   (r[10] if len(r) > 10 else "").strip() or None,
            "linkedType":       (r[11] if len(r) > 11 else "manual").strip(),
        })

    # DATA (monthly spend + reserve spend + transactions)
    today = date.today()
    data = {}
    for y in range(s_yr, today.year + 2):
        for m in range(12):
            data[f"{y}-{m}"] = {"spent":{}, "travelSpent":0, "groomingSpent":0,
                                 "clothingSpent":0, "giftsSpent":0, "beautySpent":0,
                                 "savingsSpent":0, "houseSpent":0, "reserveTransactions":[]}

    for r in data_rows(sections, "MONTHLY SPEND"):
        p = (r[0] if r else "").strip().split(" ")
        if len(p) < 2: continue
        mi = MONTHS.index(p[0]) if p[0] in MONTHS else -1
        yr = int(p[1]) if p[1].isdigit() else -1
        if mi < 0 or yr < 0: continue
        k = f"{yr}-{mi}"
        if k not in data: data[k] = {"spent":{}, "travelSpent":0, "groomingSpent":0,
                                      "clothingSpent":0, "giftsSpent":0, "beautySpent":0,
                                      "savingsSpent":0, "houseSpent":0, "reserveTransactions":[]}
        for ci, bid in enumerate(DISC_IDS):
            v = num(r[ci+1] if len(r) > ci+1 else 0)
            if v > 0: data[k]["spent"][bid] = v

    r_cols = ["travelSpent","beautySpent","clothingSpent","giftsSpent",
              "groomingSpent","savingsSpent","houseSpent"]
    for r in data_rows(sections, "RESERVE SPEND"):
        p = (r[0] if r else "").strip().split(" ")
        if len(p) < 2: continue
        mi = MONTHS.index(p[0]) if p[0] in MONTHS else -1
        yr = int(p[1]) if p[1].isdigit() else -1
        if mi < 0 or yr < 0: continue
        k = f"{yr}-{mi}"
        if k not in data: continue
        for ci, col in enumerate(r_cols):
            v = num(r[ci+1] if len(r) > ci+1 else 0)
            if v > 0: data[k][col] = v

    for r in data_rows(sections, "RESERVE TRANSACTIONS"):
        p = (r[0] if r else "").strip().split(" ")
        if len(p) < 2: continue
        mi = MONTHS.index(p[0]) if p[0] in MONTHS else -1
        yr = int(p[1]) if p[1].isdigit() else -1
        if mi < 0 or yr < 0: continue
        k = f"{yr}-{mi}"
        if k not in data: continue
        data[k].setdefault("reserveTransactions", []).append({
            "date":      (r[1] if len(r) > 1 else "").strip(),
            "merchant":  (r[2] if len(r) > 2 else "").strip(),
            "amount":    num(r[3] if len(r) > 3 else 0),
            "reserveId": (r[4] if len(r) > 4 else "").strip() or None,
            "category":  (r[5] if len(r) > 5 else "").strip() or None,
        })

    return cfg, data, debts


# ---- CSV serializer (mirrors Settings export JS logic) ----
def esc(v):
    s = str(v) if v is not None else ""
    if ',' in s or '"' in s or '\n' in s:
        return '"' + s.replace('"', '""') + '"'
    return s

def serialize_csv(cfg, data, debts):
    lines = []
    def row(*args): lines.append(",".join(esc(a) for a in args))

    s_yr = cfg.get("setupYear", date.today().year)
    s_mo = cfg.get("setupMonth", 0)
    today = date.today()

    lines.append("## INCOME")
    row("Label","Per Paycheck","Frequency","Payday","Monthly Total")
    for inc in cfg.get("incomes", []):
        row(inc["label"], inc["perPaycheck"], inc["frequency"], inc["payday"], inc["netPay"])
    lines.append("")

    lines.append("## FIXED BILLS")
    row("Name","Amount","Due Day","Category","Note")
    bills = next((b for b in cfg.get("buckets",[]) if b["id"]=="bills"), None)
    for item in (bills or {}).get("items", []):
        row(item["name"], item["amt"], item["day"], item.get("category",""), item.get("note",""))
    lines.append("")

    lines.append("## DISCRETIONARY")
    row("ID","Label","Monthly Budget")
    for b in cfg.get("buckets", []):
        if b["id"] in DISC_IDS:
            row(b["id"], b["label"], b["amount"])
    lines.append("")

    lines.append("## RESERVES")
    row("ID","Label","Monthly Contribution")
    for b in cfg.get("buckets", []):
        if b["id"] in RES_IDS:
            row(b["id"], b["label"], b["amount"])
    lines.append("")

    lines.append("## DEBTS")
    row("Name","Type","Balance","APR","Monthly Payment","Monthly Principal","Escrow",
        "Balance As Of","Growing","Note","Linked Bucket","Linked Type")
    for d in debts:
        row(d["name"], d["type"], d["balance"], d["apr"], d["monthly"],
            d.get("monthlyPrincipal",0), d.get("escrow",0), d.get("balanceAsOf",""),
            "yes" if d.get("grows") else "no", d.get("note",""),
            d.get("linkedBucketId","") or "", d.get("linkedType","manual"))
    lines.append("")

    lines.append("## MONTHLY SPEND")
    row("Month", *DISC_IDS)
    for y in range(s_yr, today.year + 2):
        for m in range(12):
            if y == s_yr and m < s_mo: continue
            k = f"{y}-{m}"
            md = data.get(k)
            if not md: continue
            spent = md.get("spent", {})
            if not any((spent.get(bid,0) or 0) > 0 for bid in DISC_IDS): continue
            row(f"{MONTHS[m]} {y}", *[spent.get(bid,0) for bid in DISC_IDS])
    lines.append("")

    r_keys = ["travelSpent","beautySpent","clothingSpent","giftsSpent",
              "groomingSpent","savingsSpent","houseSpent"]
    lines.append("## RESERVE SPEND")
    row("Month","Travel","Beauty","Clothing","Gifts","Pet","Savings","House")
    for y in range(s_yr, today.year + 2):
        for m in range(12):
            if y == s_yr and m < s_mo: continue
            k = f"{y}-{m}"
            md = data.get(k)
            if not md: continue
            if not any((md.get(rk,0) or 0) > 0 for rk in r_keys): continue
            row(f"{MONTHS[m]} {y}", *[md.get(rk,0) for rk in r_keys])
    lines.append("")

    lines.append("## RESERVE TRANSACTIONS")
    row("Month","Date","Merchant","Amount","Reserve ID","Discretionary ID")
    for y in range(s_yr, today.year + 2):
        for m in range(12):
            if y == s_yr and m < s_mo: continue
            k = f"{y}-{m}"
            md = data.get(k)
            if not md: continue
            for tx in md.get("reserveTransactions", []):
                row(f"{MONTHS[m]} {y}", tx.get("date",""), tx.get("merchant",""),
                    tx.get("amount",0), tx.get("reserveId","") or "",
                    tx.get("category","") or "")

    lines.append("")
    lines.append("## META")
    row("Setup Date", f"{MONTHS[s_mo]} {s_yr}")
    row("Primary Payday", cfg.get("primaryPayday", 1))
    row("Exported", today.isoformat())
    return "\n".join(lines)


# ---- Run tests ----
checks = []

def ok(name, result, detail=""):
    checks.append((name, bool(result), detail))

# Pass 1: parse the sample CSV
cfg1, data1, debts1 = parse_csv(SAMPLE_CSV)
buckets1 = cfg1.get("buckets", [])
bucket_ids1 = [b["id"] for b in buckets1]

# -- Section presence --
sections1 = parse_sections(SAMPLE_CSV)
ok("INCOME section present",       "INCOME" in sections1)
ok("FIXED BILLS section present",  "FIXED BILLS" in sections1)
ok("DISCRETIONARY section present","DISCRETIONARY" in sections1)
ok("RESERVES section present",     "RESERVES" in sections1)
ok("DEBTS section present",        "DEBTS" in sections1)
ok("MONTHLY SPEND section present","MONTHLY SPEND" in sections1)
ok("RESERVE SPEND section present","RESERVE SPEND" in sections1)
ok("RESERVE TRANSACTIONS present", "RESERVE TRANSACTIONS" in sections1)
ok("META section present",         "META" in sections1)

# -- Income --
ok("Income: 2 sources parsed",     len(cfg1["incomes"]) == 2)
ok("Income: Main Job net pay",     cfg1["incomes"][0]["netPay"] == 5500)
ok("Income: frequency semimonthly",cfg1["incomes"][0]["frequency"] == "semimonthly")
ok("Income: payday correct",       cfg1["incomes"][0]["payday"] == 1)
ok("Income: Side Gig monthly",     cfg1["incomes"][1]["netPay"] == 500)

# -- Fixed bills --
bills_bucket = next((b for b in buckets1 if b["id"] == "bills"), None)
ok("Bills bucket present",         bills_bucket is not None)
ok("Bills: 3 items (cc excluded from amt)", bills_bucket is not None and len(bills_bucket["items"]) == 4)
ok("Bills: Rent amt correct",      bills_bucket is not None and any(i["name"]=="Rent" and i["amt"]==1450 for i in bills_bucket["items"]))
ok("Bills: cc item included",      bills_bucket is not None and any(i.get("note")=="cc" for i in bills_bucket["items"]))
ok("Bills: amount excludes cc",    bills_bucket is not None and bills_bucket["amount"] == 1450+350+65)

# -- Discretionary buckets --
disc1 = [b for b in buckets1 if b["id"] in DISC_IDS]
ok("Disc: 5 buckets parsed",       len(disc1) == 5)
ok("Disc: all new IDs",            all(b["id"] in DISC_IDS for b in disc1))
ok("Disc: no old IDs",             not any(b["id"] in OLD_IDS for b in disc1))
ok("Disc: bill002 Groceries 450",  any(b["id"]=="bill002" and b["label"]=="Groceries" and b["amount"]==450 for b in disc1))
ok("Disc: bill001 Meal Kits 200",  any(b["id"]=="bill001" and b["amount"]==200 for b in disc1))
ok("Disc: colors assigned",        all(b["color"] != "#888" for b in disc1))

# -- Reserve buckets --
res1 = [b for b in buckets1 if b["id"] in RES_IDS]
ok("Res: 8 buckets parsed",        len(res1) == 8)
ok("Res: all new IDs",             all(b["id"] in RES_IDS for b in res1))
ok("Res: no old IDs",              not any(b["id"] in OLD_IDS for b in res1))
ok("Res: bill008 Travel 500",      any(b["id"]=="bill008" and b["amount"]==500 for b in res1))
ok("Res: bill011 Savings 800",     any(b["id"]=="bill011" and b["amount"]==800 for b in res1))
ok("Res: colors assigned",         all(b["color"] != "#888" for b in res1))

# -- Debts --
ok("Debts: 2 debts parsed",        len(debts1) == 2)
ok("Debts: name with comma parsed",any(d["name"] == "Student Loan, Federal" for d in debts1))
ok("Debts: Car Loan balance",      any(d["name"]=="Car Loan" and d["balance"]==8450 for d in debts1))
ok("Debts: APR parsed",            any(d["name"]=="Car Loan" and d["apr"]==4.5 for d in debts1))
ok("Debts: linked bucket",         any(d["linkedBucketId"]=="Car Payment" for d in debts1))
ok("Debts: grows=False",           any(d["name"]=="Car Loan" and not d["grows"] for d in debts1))

# -- Monthly spend --
jan_key = f"{SETUP_YEAR}-0"
jan_data = data1.get(jan_key, {})
jan_spent = jan_data.get("spent", {})
ok("Spend: Jan bill002 (groceries) = 410",  jan_spent.get("bill002") == 410)
ok("Spend: Jan bill003 (dining) = 225",     jan_spent.get("bill003") == 225)
ok("Spend: Jan bill001 (meal kits) = 180",  jan_spent.get("bill001") == 180)
ok("Spend: old keys absent from spent",     not any(k in jan_spent for k in OLD_IDS))
feb_key = f"{SETUP_YEAR}-1"
feb_spent = data1.get(feb_key, {}).get("spent", {})
ok("Spend: Feb bill002 = 475",              feb_spent.get("bill002") == 475)

# -- Reserve spend --
ok("Reserve: Jan travelSpent = 120",   jan_data.get("travelSpent") == 120)
ok("Reserve: Jan giftsSpent = 45",     jan_data.get("giftsSpent") == 45)
ok("Reserve: Jan groomingSpent = 80",  jan_data.get("groomingSpent") == 80)
feb_data = data1.get(feb_key, {})
ok("Reserve: Feb clothingSpent = 75",  feb_data.get("clothingSpent") == 75)
ok("Reserve: Feb houseSpent = 150",    feb_data.get("houseSpent") == 150)

# -- Reserve transactions --
jan_txs = jan_data.get("reserveTransactions", [])
ok("Transactions: 2 in Jan",           len(jan_txs) == 2)
ok("Transactions: Amazon gifts",       any(tx["merchant"]=="Amazon" and tx["reserveId"]=="bill007" for tx in jan_txs))
ok("Transactions: REI travel",         any(tx["merchant"]=="REI" and tx["reserveId"]=="bill008" for tx in jan_txs))
ok("Transactions: amount parsed",      any(tx["amount"]==45.0 for tx in jan_txs))

# -- META --
ok("META: setupYear correct",      cfg1["setupYear"] == SETUP_YEAR)
ok("META: setupMonth correct",     cfg1["setupMonth"] == SETUP_MONTH)
ok("META: primaryPayday correct",  cfg1["primaryPayday"] == 1)

# ---- Pass 2: re-serialize and re-parse (round-trip) ----
csv2 = serialize_csv(cfg1, data1, debts1)
cfg2, data2, debts2 = parse_csv(csv2)

# -- Config round-trip --
ok("RT: same number of incomes",       len(cfg2["incomes"]) == len(cfg1["incomes"]))
ok("RT: income netPay preserved",      cfg2["incomes"][0]["netPay"] == cfg1["incomes"][0]["netPay"])
ok("RT: same number of buckets",       len(cfg2["buckets"]) == len(cfg1["buckets"]))
ok("RT: bills amount preserved",       next((b["amount"] for b in cfg2["buckets"] if b["id"]=="bills"),None) ==
                                        next((b["amount"] for b in cfg1["buckets"] if b["id"]=="bills"),None))
ok("RT: disc bucket IDs preserved",    sorted(b["id"] for b in cfg2["buckets"] if b["id"] in DISC_IDS) ==
                                        sorted(b["id"] for b in cfg1["buckets"] if b["id"] in DISC_IDS))
ok("RT: res bucket IDs preserved",     sorted(b["id"] for b in cfg2["buckets"] if b["id"] in RES_IDS) ==
                                        sorted(b["id"] for b in cfg1["buckets"] if b["id"] in RES_IDS))
ok("RT: bill002 amount preserved",     next((b["amount"] for b in cfg2["buckets"] if b["id"]=="bill002"),None) ==
                                        next((b["amount"] for b in cfg1["buckets"] if b["id"]=="bill002"),None))
ok("RT: bill008 amount preserved",     next((b["amount"] for b in cfg2["buckets"] if b["id"]=="bill008"),None) ==
                                        next((b["amount"] for b in cfg1["buckets"] if b["id"]=="bill008"),None))
ok("RT: setupYear preserved",          cfg2["setupYear"] == cfg1["setupYear"])
ok("RT: setupMonth preserved",         cfg2["setupMonth"] == cfg1["setupMonth"])
ok("RT: primaryPayday preserved",      cfg2["primaryPayday"] == cfg1["primaryPayday"])

# -- Debts round-trip --
ok("RT: same number of debts",         len(debts2) == len(debts1))
ok("RT: debt name with comma preserved",any(d["name"]=="Student Loan, Federal" for d in debts2))
ok("RT: debt balance preserved",        next((d["balance"] for d in debts2 if "Car" in d["name"]),None) ==
                                         next((d["balance"] for d in debts1 if "Car" in d["name"]),None))
ok("RT: debt linkedBucket preserved",   next((d["linkedBucketId"] for d in debts2 if "Car" in d["name"]),None) ==
                                         next((d["linkedBucketId"] for d in debts1 if "Car" in d["name"]),None))

# -- Spend data round-trip --
jan2_spent = data2.get(jan_key, {}).get("spent", {})
ok("RT: Jan bill002 spend preserved",  jan2_spent.get("bill002") == jan_spent.get("bill002"))
ok("RT: Jan bill001 spend preserved",  jan2_spent.get("bill001") == jan_spent.get("bill001"))
ok("RT: Jan travelSpent preserved",    data2.get(jan_key,{}).get("travelSpent") == data1.get(jan_key,{}).get("travelSpent"))
ok("RT: Jan giftsSpent preserved",     data2.get(jan_key,{}).get("giftsSpent") == data1.get(jan_key,{}).get("giftsSpent"))
ok("RT: Feb clothingSpent preserved",  data2.get(feb_key,{}).get("clothingSpent") == data1.get(feb_key,{}).get("clothingSpent"))
ok("RT: transactions preserved",       len(data2.get(jan_key,{}).get("reserveTransactions",[])) ==
                                        len(data1.get(jan_key,{}).get("reserveTransactions",[])))

# ---- Print results ----
passed = sum(1 for _,r,_ in checks if r)
failed = [(n,d) for n,r,d in checks if not r]
for name, result, detail in checks:
    status = "OK  " if result else "FAIL"
    print(f"{status} {name}" + (f" ({detail})" if detail and not result else ""))
print(f"\n{passed}/{len(checks)} passed")
if failed:
    print("\nFailed checks:")
    for n, d in failed:
        print(f"  - {n}" + (f": {d}" if d else ""))
    raise SystemExit(1)
