#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.yaml")

def load_config():
    with open(CONFIG_PATH, "r") as f:
        content = f.read()
    # Simple parser for the YAML config
    cfg = {}
    lines = content.splitlines()
    section = None
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.endswith(":") and not stripped.startswith("-"):
            section = stripped[:-1].strip()
            cfg[section] = {}
            continue
        if ":" in stripped and section:
            key, val = stripped.split(":", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            cfg[section][key] = val
    return cfg

def matrix_request(url, token, method="GET", data=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, headers=headers, method=method)
    if data is not None:
        req.data = json.dumps(data).encode("utf-8")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Matrix request failed: {e}", file=sys.stderr)
        return None

def set_typing(homeserver, token, room_id, user_id, typing=True):
    url = f"{homeserver}/_matrix/client/v3/rooms/{urllib.parse.quote(room_id)}/typing/{urllib.parse.quote(user_id)}"
    matrix_request(url, token, method="PUT", data={"typing": typing, "timeout": 30000 if typing else 0})

def send_reaction(homeserver, token, room_id, event_id, emoji):
    txn_id = f"m{int(time.time()*1000)}"
    url = f"{homeserver}/_matrix/client/v3/rooms/{urllib.parse.quote(room_id)}/send/m.reaction/{txn_id}"
    data = {
        "m.relates_to": {
            "rel_type": "m.annotation",
            "event_id": event_id,
            "key": emoji,
        }
    }
    matrix_request(url, token, method="PUT", data=data)

def send_message(homeserver, token, room_id, text, in_reply_to=None):
    txn_id = f"m{int(time.time()*1000)}_{os.urandom(2).hex()}"
    url = f"{homeserver}/_matrix/client/v3/rooms/{urllib.parse.quote(room_id)}/send/m.room.message/{txn_id}"
    
    # We can format Markdown using our matrix-mcp-go binary format engine if needed,
    # or send direct markdown text with html formatting
    data = {
        "msgtype": "m.text",
        "body": text,
    }
    if in_reply_to:
        data["m.relates_to"] = {
            "m.in_reply_to": {
                "event_id": in_reply_to
            }
        }
    return matrix_request(url, token, method="PUT", data=data)

def ask_pi(prompt):
    print(f"Invoking Pi Agent with prompt: {prompt[:80]}...", flush=True)
    try:
        proc = subprocess.run(
            ["pi", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=120
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
        else:
            return f"Error from agent: {proc.stderr.strip()}"
    except subprocess.TimeoutExpired:
        return "Sorry, the agent timed out while thinking."
    except Exception as e:
        return f"Failed to run agent: {e}"

def main():
    cfg = load_config()
    matrix_cfg = cfg.get("matrix", {})
    homeserver = matrix_cfg.get("homeserver_url", "").rstrip("/")
    token = matrix_cfg.get("access_token", "")
    bot_user_id = matrix_cfg.get("user_id", "")
    allowed_user = "@amadeus:matrix.kurisu.ir"

    print(f"Starting Matrix Auto-Responder for {bot_user_id} on {homeserver}...", flush=True)

    # Initial sync to catch up and avoid replying to old history
    print("Fetching initial sync batch token...", flush=True)
    init_res = matrix_request(f"{homeserver}/_matrix/client/v3/sync?timeout=0", token)
    next_batch = init_res.get("next_batch") if init_res else None
    print(f"Ready and listening! (next_batch={next_batch})", flush=True)

    processed_events = set()

    while True:
        try:
            sync_url = f"{homeserver}/_matrix/client/v3/sync?timeout=30000"
            if next_batch:
                sync_url += f"&since={next_batch}"
            
            res = matrix_request(sync_url, token)
            if not res:
                time.sleep(3)
                continue

            next_batch = res.get("next_batch", next_batch)
            joined_rooms = res.get("rooms", {}).get("join", {})

            for room_id, room_data in joined_rooms.items():
                events = room_data.get("timeline", {}).get("events", [])
                for ev in events:
                    ev_id = ev.get("event_id")
                    if not ev_id or ev_id in processed_events:
                        continue
                    processed_events.add(ev_id)

                    sender = ev.get("sender")
                    ev_type = ev.get("type")

                    if ev_type != "m.room.message" or sender == bot_user_id:
                        continue

                    if sender != allowed_user:
                        print(f"Ignoring message from unauthorized user: {sender}", flush=True)
                        continue

                    content = ev.get("content", {})
                    body = content.get("body", "").strip()
                    if not body:
                        continue

                    print(f"\n[Matrix] Received message from {sender} in {room_id}: {body}", flush=True)

                    # 1. Acknowledge with eyes reaction
                    send_reaction(homeserver, token, room_id, ev_id, "👀")

                    # 2. Show typing indicator
                    set_typing(homeserver, token, room_id, bot_user_id, True)

                    # 3. Process with Pi Agent
                    agent_prompt = f"User @amadeus on Matrix sent: {body}\nPlease answer helpfully and concisely."
                    answer = ask_pi(agent_prompt)

                    # 4. Stop typing & send response
                    set_typing(homeserver, token, room_id, bot_user_id, False)
                    send_message(homeserver, token, room_id, answer, in_reply_to=ev_id)

                    # 5. React with checkmark
                    send_reaction(homeserver, token, room_id, ev_id, "✅")
                    print(f"[Matrix] Replied to {ev_id}", flush=True)

        except Exception as err:
            print(f"Loop error: {err}", file=sys.stderr, flush=True)
            time.sleep(3)

if __name__ == "__main__":
    main()
