#!/usr/bin/env python3
import sys
import json
import subprocess
import os

BIN_PATH = os.path.join(os.path.dirname(__file__), "..", "bin", "matrix-mcp-go")
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.yaml")

def create_mcp_process():
    return subprocess.Popen(
        [BIN_PATH, "-config", CONFIG_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

def init_mcp(p):
    # 1. Initialize
    p.stdin.write(json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "antigravity-bridge", "version": "1.0"}
        }
    }) + "\n")
    p.stdin.flush()
    p.stdout.readline()

    # 2. Initialized notification
    p.stdin.write(json.dumps({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    }) + "\n")
    p.stdin.flush()

def call_tool(p, req_id, name, args):
    p.stdin.write(json.dumps({
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "tools/call",
        "params": {
            "name": name,
            "arguments": args
        }
    }) + "\n")
    p.stdin.flush()
    line = p.stdout.readline()
    return json.loads(line)

def main():
    if len(sys.argv) < 2:
        print("Usage: antigravity_bridge.py [wait <timeout>|send <room_id> <message> [thread_id]]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    p = create_mcp_process()
    init_mcp(p)

    try:
        if cmd == "wait":
            timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 120
            res = call_tool(p, 2, "matrix_wait_message", {"timeout_seconds": timeout})
            content_text = res.get("result", {}).get("content", [{}])[0].get("text", "{}")
            print(content_text)

        elif cmd == "send":
            room_id = sys.argv[2]
            msg_arg = sys.argv[3] if len(sys.argv) > 3 else "-"
            if msg_arg == "-":
                message = sys.stdin.read()
            else:
                message = msg_arg
            thread_id = sys.argv[4] if len(sys.argv) > 4 else ""
            if thread_id and not thread_id.startswith("$"):
                thread_id = "$" + thread_id
            args = {"room_id": room_id, "message": message}
            if thread_id:
                args["thread_id"] = thread_id
            res = call_tool(p, 2, "matrix_send_message", args)
            content_text = res.get("result", {}).get("content", [{}])[0].get("text", "{}")
            print(content_text)
            if thread_id:
                call_tool(p, 3, "matrix_send_reaction", {"room_id": room_id, "event_id": thread_id, "emoji": "✅"})

    finally:
        p.terminate()

if __name__ == "__main__":
    main()
