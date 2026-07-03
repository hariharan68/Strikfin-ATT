import asyncio, asyncpg
from collections import defaultdict

async def main():
    conn = await asyncpg.connect(host="localhost", user="postgres", password="admin", database="StrikfinDB")
    print("== NIFTY snapshots today: spot + total OI ==")
    rows = await conn.fetch("""
        SELECT snap_ts, spot, total_call_oi, total_put_oi
        FROM option_chain_snapshots
        WHERE instrument_id=1 AND trade_date='2026-07-03' ORDER BY snap_ts
    """)
    for r in rows:
        tot=(r['total_call_oi'] or 0)+(r['total_put_oi'] or 0)
        print(f"  {r['snap_ts'].strftime('%H:%M:%S')}UTC spot={float(r['spot']):.2f} totOI={tot/1e7:.2f}Cr")
    print("\n== per-strike OI (24300/24350/24400) across snapshots ==")
    rows = await conn.fetch("""
        SELECT s.snap_ts, r.strike, r.option_type, r.oi
        FROM option_chain_rows r
        JOIN option_chain_snapshots s ON s.snapshot_id=r.snapshot_id
        WHERE s.instrument_id=1 AND s.trade_date='2026-07-03'
          AND r.strike IN (24300,24350,24400)
        ORDER BY s.snap_ts, r.strike, r.option_type
    """)
    bytime=defaultdict(dict)
    for r in rows:
        bytime[r['snap_ts'].strftime('%H:%M')][f"{int(r['strike'])}{r['option_type']}"]=r['oi']
    for t in sorted(bytime):
        row=bytime[t]
        print(f"  {t}UTC " + " ".join(f"{k}={row[k]/1e7:.2f}Cr" for k in sorted(row)))
    await conn.close()

asyncio.run(main())
