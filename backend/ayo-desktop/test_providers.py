import json
import unittest
from threading import Event
from unittest.mock import patch
from providers import generate


class Response:
    def __init__(self, lines):
        self.lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def raise_for_status(self):
        pass

    def iter_lines(self, **kwargs):
        return iter(self.lines)


class StreamTests(unittest.TestCase):
    def test_all_stream_formats(self):
        samples = {
            "Ollama": [json.dumps({"message":{"content":"أهلاً"}}).encode(), b'{"done":true}'],
            "OpenAI": [b'data: {"choices":[{"delta":{"content":"hello"}}]}', b'data: [DONE]'],
            "Anthropic": [b'data: {"type":"content_block_delta","delta":{"text":"hello"}}',
                          b'data: {"type":"message_stop"}']
        }
        for provider, lines in samples.items():
            with self.subTest(provider=provider), patch("providers.requests.post", return_value=Response(lines)):
                output = "".join(generate(provider,"model",[],"test",Event()))
                self.assertEqual(output, "أهلاً" if provider == "Ollama" else "hello")

    def test_incomplete_stream(self):
        with patch("providers.requests.post", return_value=Response([])), self.assertRaises(RuntimeError):
            list(generate("Ollama","model",[],"",Event()))

    def test_cancel(self):
        stop = Event()
        stop.set()
        with patch("providers.requests.post", return_value=Response([b'{"done":true}'])):
            self.assertEqual(list(generate("Ollama","model",[],"",stop)), [])
