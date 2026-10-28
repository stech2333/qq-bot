"""Optional aiotieba worker. JSON stdin/stdout only; no write methods or user profiles.
Install aiotieba separately in an operator-selected Python environment. Not invoked at import.
"""
import asyncio
import json
import os
import sys


def checked(value):
    if getattr(value, "err", None):
        raise RuntimeError("NETWORK")
    return value


async def execute(req):
    import aiotieba
    async with aiotieba.Client(os.environ.get("QQ_COMMUNITY_CREDENTIAL", "")) as client:
        action = req.get("action")
        if action == "probe":
            checked(await client.get_threads(req["target"], pn=1, rn=2))
            return {"ready": True}
        if action == "discover":
            page = int(req.get("cursor") or 1)
            rows = checked(await client.get_threads(req["target"], pn=page, rn=20))
            return {"items": [{"id": str(r.tid), "title": r.title[:200],
                    "summary": r.text[:400], "url": f"https://tieba.baidu.com/p/{r.tid}",
                    "publishedAt": int(r.create_time) * 1000,
                    "revision": str(getattr(r, "reply_num", 0)) + ":" + str(getattr(r, "last_time", 0))}
                    for r in rows], "cursor": page + 1 if rows.page.has_more else 1,
                    "hasMore": bool(rows.page.has_more)}
        if action != "read":
            raise RuntimeError("UNAVAILABLE")
        tid = int(req["id"])
        state = req.get("cursor") or {"page": 1}
        # Read floor pages and then all nested reply pages, preserving parent IDs.
        if "parents" in state:
            pid = state["parents"][0]
            rows = checked(await client.get_comments(tid, int(pid), pn=state.get("replyPage", 1)))
            text = "\n".join(f"帖子{tid}/楼层{pid}/回复{r.pid}: {r.text}" for r in rows)
            if rows.page.has_more:
                nxt = {**state, "replyPage": state.get("replyPage", 1) + 1}
            elif len(state["parents"]) > 1:
                nxt = {**state, "parents": state["parents"][1:], "replyPage": 1}
            else:
                nxt = state.get("next")
        else:
            rows = checked(await client.get_posts(tid, pn=state["page"], rn=10, with_comments=False))
            text = "\n".join(f"帖子{tid}/楼层{r.pid}: {r.text}" for r in rows)
            after = {"page": state["page"] + 1} if rows.page.has_more else None
            parents = [str(r.pid) for r in rows if getattr(r, "reply_num", 0) > 0]
            nxt = {"parents": parents, "replyPage": 1, "next": after} if parents else after
        # Oversize pages are rejected, not silently declared fully read.
        if len(text) > 16000:
            raise RuntimeError("OVERSIZE")
        return {"text": text, "readCursor": nxt, "complete": nxt is None}


if __name__ == "__main__":
    try:
        raw = sys.stdin.readline(32769)
        if len(raw) > 32768:
            raise RuntimeError("UNAVAILABLE")
        result = asyncio.run(asyncio.wait_for(execute(json.loads(raw)), timeout=25))
    except ModuleNotFoundError:
        result = {"error": "UNAVAILABLE"}
    except Exception as error:
        code = str(error)
        result = {"error": code if code in {"AUTH", "RATE_LIMITED", "UNAVAILABLE", "OVERSIZE"} else "NETWORK"}
    print(json.dumps(result, ensure_ascii=False), flush=True)
