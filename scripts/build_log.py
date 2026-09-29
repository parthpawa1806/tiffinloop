"""Turn a Claude Code session export (zip) into a readable Markdown build log.

    python scripts/build_log.py <session-export.zip> [docs/BUILD_LOG.md]

Keeps every prompt and every response in order. Each tool call becomes a one-line summary
(what was run, and whether it failed). Model reasoning and raw tool output are left out:
they are not prompts or responses, and they would bury the conversation. The user's email
address is redacted.
"""

import json
import re
import sys
import zipfile
from pathlib import Path

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
TAG_BLOCKS = re.compile(r"<(system-reminder|local-command-stdout)>.*?</\1>", re.S)
PASTED = re.compile(r"</?pasted_content[^>]*>")
SERVERS = {
    "8eea97a8": "Supabase",
    "0ba48c47": "Vercel",
    "Claude_Browser": "Browser",
    "visualize": "Diagram",
    "ccd_session": "Session",
    "ccd_session_mgmt": "Session",
}


def clean(text: str) -> str:
    text = TAG_BLOCKS.sub("", text)
    text = PASTED.sub("", text)
    text = EMAIL.sub("[email redacted]", text)
    return text.strip()


def tool_name(name: str) -> str:
    if not name.startswith("mcp__"):
        return name
    _, server, action = name.split("__", 2)
    for key, label in SERVERS.items():
        if server.startswith(key):
            return f"{label}: {action}"
    return f"{server}: {action}"


def tool_summary(block: dict) -> str:
    inp = block.get("input") or {}
    detail = (
        inp.get("description")
        or inp.get("title")
        or inp.get("file_path")
        or inp.get("url")
        or inp.get("pattern")
        or inp.get("query")
        or inp.get("name")
        or inp.get("idOrName")
        or inp.get("repo")
        or ""
    )
    if isinstance(detail, str):
        detail = detail.replace("\n", " ").strip()
        # Local paths: keep the part inside the project.
        detail = re.sub(r"^.*?Stampmyvisa Assignment[\\/]+", "", detail)
        if len(detail) > 140:
            detail = detail[:137] + "..."
    return f"`{tool_name(block['name'])}`" + (f": {detail}" if detail else "")


def main(zip_path: str, out_path: str) -> None:
    with zipfile.ZipFile(zip_path) as z:
        rows = [json.loads(line) for line in z.read("transcript.jsonl").decode("utf-8").splitlines() if line.strip()]

    out: list[str] = []
    speaker = None  # "user" | "claude"
    tool_lines: dict[str, int] = {}  # tool_use id -> index in out
    prompts = responses = tools = 0

    def start(who: str, heading: str) -> None:
        nonlocal speaker
        if speaker != who or who == "user":
            out.append(f"\n---\n\n### {heading}\n")
        speaker = who

    for r in rows:
        kind = r.get("type")
        att = r.get("attachment") or {}

        if kind == "attachment" and att.get("type") == "queued_command" and att.get("humanTurn"):
            start("user", "User (sent while Claude was working)")
            out.append(clean(att.get("prompt", "")) + "\n")
            prompts += 1
            continue
        if kind == "attachment" and att.get("type") == "file":
            name = Path(str(att.get("filename") or att.get("path") or "file")).name
            out.append(f"*Attached file: `{name}`*\n")
            continue
        if kind not in ("user", "assistant"):
            continue

        content = r["message"]["content"]
        if kind == "user":
            texts = [content] if isinstance(content, str) else [b.get("text", "") for b in content if b.get("type") == "text"]
            for b in content if isinstance(content, list) else []:
                if b.get("type") == "tool_result" and b.get("is_error") and b.get("tool_use_id") in tool_lines:
                    body = b.get("content")
                    msg = body if isinstance(body, str) else " ".join(x.get("text", "") for x in body or [] if isinstance(x, dict))
                    first = clean(msg).splitlines()[0][:160] if clean(msg) else "error"
                    out[tool_lines[b["tool_use_id"]]] += f" (failed: {first})"
            for t in texts:
                if "<task-notification>" in t:
                    out.append("*(A background task finished.)*\n")
                    continue
                if "<local-command-caveat>" in t:
                    continue
                m = re.search(r"<command-name>(.*?)</command-name>", t)
                if m:
                    out.append(f"*(User ran `{m.group(1)}` in the app.)*\n")
                    continue
                t = clean(t)
                if not t or t == "Tool loaded.":
                    continue
                start("user", "User")
                out.append(t + "\n")
                prompts += 1
        else:
            for b in content:
                if b.get("type") == "text" and clean(b.get("text", "")):
                    start("claude", "Claude")
                    if out and out[-1].startswith("- Tool:"):
                        out.append("")  # end the tool list so the text isn't read as part of it
                    out.append(clean(b["text"]) + "\n")
                    responses += 1
                elif b.get("type") == "tool_use":
                    start("claude", "Claude")
                    out.append(f"- Tool: {tool_summary(b)}")
                    tool_lines[b["id"]] = len(out) - 1
                    tools += 1

    header = [
        "# Build log: TiffinLoop ops tool",
        "",
        "Full conversation with Claude Code (Claude Opus 5.5, Claude desktop app) that produced this repository:",
        "every prompt and every response, in order.",
        "",
        "- Tool calls are summarised on one line each (file written, command run, query executed) and marked when they failed.",
        "- Left out: the model's internal reasoning and raw tool output. The original session export (zip) is available on request.",
        "- The author's email address is redacted.",
        "",
        f"**{prompts} prompts, {responses} responses, {tools} tool calls.**",
        "",
    ]
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text("\n".join(header + out) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}: {prompts} prompts, {responses} responses, {tools} tool calls")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "docs/BUILD_LOG.md")
