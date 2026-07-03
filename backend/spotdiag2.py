import asyncio, asyncpg, time
from app.ingestion.providers.fyers_provider import _get_fyers

async def db():
    conn = await asyncpg.connect(host="localhost", user="postgres", password="admin", database="StrikfinDB")
    print("== latest index_live_data (NIFTY) ==")
    rows = await conn.fetch("""
        SELECT snap_ts, last_price, prev_close, change_pct, india_vix
        FROM index_live_data WHERE instrument_id=1
        ORDER BY snap_ts DESC LIMIT 8
    """)
    for r in rows: print(dict(r))
    await conn.close()

asyncio.run(db())

print("\n== retrying batched Fyers quotes (up to 6 tries) ==")
fyers = _get_fyers()
syms = "NSE:NIFTY50-INDEX,BSE:SENSEX-INDEX,NSE:INDIAVIX-INDEX"
for i in range(6):
    r = fyers.quotes({"symbols": syms})
    code = r.get("code") or r.get("s")
    print(f"try {i}: code={code}")
    if r.get("s") == "ok" or r.get("code") == 200:
        for d in r.get("d", []):
            v = d.get("v", {})
            print("  ", d.get("n"), "lp=", v.get("lp"), "prev=", v.get("prev_close_price"), "chp=", v.get("chp"))
        break
    time.sleep(3)
