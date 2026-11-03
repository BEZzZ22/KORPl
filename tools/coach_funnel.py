# Воронка платного тренера по выгрузке D1 (json от wrangler). Репо публичный: печатаем только числа, без имён и id.
# Аргументы: seen.json act.json wallet.json paid.json refn.json prize.json owner_ids
import json, sys, time

def rows(path):
    try:
        return json.load(open(path))[0]["results"]
    except Exception:
        return []

seen_f, act_f, wal_f, paid_f, refn_f, prize_f, owners = sys.argv[1:8]
OWN = {x.strip() for x in owners.split(",") if x.strip()}
uid = lambda k: k.split(":")[-1]
now = time.time() * 1000

users = {uid(r["k"]) for r in rows(seen_f)} - OWN
ev, buy_path = {}, set()
for r in rows(act_f):
    i = uid(r["k"])
    if i in OWN:
        continue
    m = json.loads(r.get("meta") or "{}")
    for k, v in (m.get("e") or {}).items():
        ev.setdefault(k, {})
        ev[k][i] = ev[k].get(i, 0) + int(v or 0)
    if any(s.split(":")[0] in ("buy", "buy_card") for s in (m.get("p") or "").split(",")):
        buy_path.add(i)

wallets = {}
for r in rows(wal_f):
    i = uid(r["k"])
    if i in OWN:
        continue
    try:
        wallets[i] = json.loads(r.get("v") or "{}")
    except Exception:
        pass

paid = [json.loads(r.get("meta") or "{}") for r in rows(paid_f)]
paid = [p for p in paid if str(p.get("u")) not in OWN]
refn = {uid(r["k"]): int(r.get("v") or 0) for r in rows(refn_f) if uid(r["k"]) not in OWN}
prizes = [r for r in rows(prize_f) if r["k"].split(":")[1] not in OWN]

n = lambda key: len(ev.get(key, {}))
print(f"Юзеров всего (без владельца): {len(users)}")
print(f"Пользовались тренером (хоть раз): {n('coach')}  вопросов тренеру задавали: {n('chat')}  сравнения: {n('compare')}")
print(f"Упёрлись в оплату (экран «бесплатные закончились»): {n('paywall')}  раз всего: {sum(ev.get('paywall', {}).values())}")
print(f"Упёрлись в замок вкладок (2-й матч без подписки): {n('lock')}  тренер стартовал сам на 1-м матче: {n('coach_auto')}")
print(f"Жали «купить» в последнем заходе дня (по пути): {len(buy_path)}")
print(f"Оплатили: {len({str(p.get('u')) for p in paid})} юзеров, {len(paid)} оплат, звёзд {sum(int(p.get('s') or 0) for p in paid)}, руб {sum(int(p.get('r') or 0) for p in paid)}")
print(f"Событие paid из приложения: {n('paid')}")
print()
print(f"Кошельков: {len(wallets)}")
free_used = sum(1 for w in wallets.values() if int(w.get("free") or 0) >= 1)
print(f"  потратили бесплатный разбор: {free_used}; бесплатный остался у юзеров без кошелька и с free=0: {len(users) - free_used}")
cred = [int(w.get("c") or 0) for w in wallets.values()]
print(f"  с разборами на счету (бонусы/пакеты): {sum(1 for c in cred if c > 0)} юзеров, всего разборов на счету: {sum(cred)}")
dist = {}
for c in cred:
    if c > 0:
        dist[c] = dist.get(c, 0) + 1
print("  раскладка (разборов: юзеров):", ", ".join(f"{k}: {v}" for k, v in sorted(dist.items())) or "нет")
print(f"  активная подписка: {sum(1 for w in wallets.values() if float(w.get('until') or 0) > now)}")
print(f"  ноль разборов и бесплатный потрачен: {sum(1 for w in wallets.values() if int(w.get('c') or 0) == 0 and int(w.get('free') or 0) >= 1 and float(w.get('until') or 0) <= now)}")
print()
print(f"Рефералка: привели друзей {sum(1 for v in refn.values() if v > 0)} юзеров, друзей всего {sum(refn.values())}")
print(f"Призы за серию дней выдано: {len(prizes)}")
