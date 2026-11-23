import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlencode
import webbrowser

from providers import generate

APPS = {"notepad": "notepad.exe", "calculator": "calc.exe"}
FOLDERS = {"documents": "Documents", "downloads": "Downloads", "music": "Music"}


def validate(plan):
    if not isinstance(plan, list) or not 1 <= len(plan) <= 6:
        raise ValueError("الخطة غير مدعومة")
    for step in plan:
        if not isinstance(step, dict) or set(step) != {"tool", "value"}:
            raise ValueError("Invalid step")
        name, value = step["tool"], step["value"]
        if not isinstance(value, str):
            raise ValueError("Invalid argument")
        if name == "open_app" and value in APPS:
            continue
        if name == "open_folder" and value in FOLDERS:
            continue
        if name == "search_web" and 0 < len(value.strip()) <= 200:
            continue
        raise ValueError("الأمر خارج الأدوات المتاحة")
    return plan


def plan_actions(provider, model, key, request, stopped):
    instruction = ('Return only a JSON array of steps with exactly "tool" and "value". '
        'Available tools: open_app (notepad or calculator), open_folder (documents, downloads, music), '
        'search_web (plain text query). Return [] for unsupported tasks. User request follows:\n')
    raw = "".join(generate(provider, model, [{"role":"user","content":instruction+request}], key, stopped))
    raw = raw.strip()
    if raw.startswith("```") and raw.endswith("```"):
        raw = raw.split("\n", 1)[1][:-3].strip()
    return validate(json.loads(raw))


def execute(step):
    validate([step])
    tool, value = step["tool"], step["value"]
    if tool == "open_app":
        binary = Path(os.environ["SystemRoot"]) / "System32" / APPS[value]
        subprocess.Popen([str(binary)])
    elif tool == "open_folder":
        folder = Path.home() / FOLDERS[value]
        if not folder.is_dir():
            raise FileNotFoundError(str(folder))
        os.startfile(folder)
    elif not webbrowser.open("https://www.google.com/search?" + urlencode({"q": value})):
        raise RuntimeError("تعذر فتح المتصفح")
