import json
import requests

MODELS = {"Ollama": "qwen3:0.6b", "OpenAI": "gpt-4o-mini", "Anthropic": "claude-sonnet-4-5"}
URLS = {"Ollama": "http://127.0.0.1:11434/api/chat",
        "OpenAI": "https://api.openai.com/v1/chat/completions",
        "Anthropic": "https://api.anthropic.com/v1/messages"}


def generate(provider, model, messages, key, stopped):
    payload = dict(model=model, messages=messages, stream=True)
    headers = {}
    if provider == "Anthropic":
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        payload["max_tokens"] = 4096
    elif provider == "OpenAI":
        headers = {"Authorization": "Bearer " + key}
    with requests.post(URLS[provider], json=payload, headers=headers, stream=True,
                       timeout=(8, 60), allow_redirects=False) as response:
        response.raise_for_status()
        for line in response.iter_lines(chunk_size=1, decode_unicode=False):
            if stopped.is_set():
                return
            if not line:
                continue
            if provider != "Ollama":
                if not line.startswith(b"data:"):
                    continue
                line = line[5:].strip()
                if line == b"[DONE]":
                    return
            event = json.loads(line)
            if event.get("error"):
                raise ValueError(str(event["error"])[:300])
            if provider == "Ollama":
                yield event.get("message", {}).get("content", "")
                if event.get("done"):
                    return
            elif provider == "OpenAI":
                for choice in event.get("choices", []):
                    yield choice.get("delta", {}).get("content") or ""
            else:
                yield event.get("delta", {}).get("text", "")
                if event.get("type") == "message_stop":
                    return
        if not stopped.is_set():
            raise RuntimeError("Stream ended before completion.")
