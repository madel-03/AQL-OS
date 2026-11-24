import unittest
from unittest.mock import patch

from local_bridge import allowed_action, valid_origin
from local_reply import FULL_LOCAL, HYBRID, OFFLINE, desktop_answer


class LocalBridgePolicyTests(unittest.TestCase):
    def test_only_fixed_actions_allow_known_arguments(self):
        self.assertEqual(allowed_action({"action": "open_folder", "folder": "downloads"}),
                         ("open_folder", "downloads"))
        self.assertEqual(allowed_action({"action": "screenshot"}), ("screenshot", None))
        for payload in (
            {"action": "open_folder", "folder": "../private"},
            {"action": "open_folder", "folder": "downloads", "path": "other"},
            {"action": "screenshot", "display": 0},
            {"action": "run", "command": "whoami"},
        ):
            self.assertIsNone(allowed_action(payload), payload)

    def test_origin_has_no_credentials_or_paths(self):
        self.assertTrue(valid_origin("https://aql-os-orcin.vercel.app"))
        self.assertTrue(valid_origin("http://localhost:5173"))
        self.assertFalse(valid_origin("http://public.example"))
        self.assertFalse(valid_origin("https://name@host.example"))
        self.assertFalse(valid_origin("https://host.example/settings"))


class DesktopRoutingTests(unittest.TestCase):
    @patch("local_reply.local_answer", return_value="local")
    @patch("local_reply.cloud_answer", return_value="cloud")
    @patch("local_reply.windows_ocr", return_value="sum = 2 + 3")
    def test_hybrid_channels_and_local_modes(self, _ocr, cloud, local):
        frame = "image"
        ocr = "ocr-image"
        token = "fixture"
        self.assertEqual(desktop_answer("اشرح الكود", frame, ocr, mode=HYBRID, token=token), "cloud")
        cloud.assert_called_once_with("اشرح الكود", token, text="sum = 2 + 3")
        cloud.reset_mock()
        self.assertEqual(desktop_answer("حلّل الرسم البياني", frame, ocr, mode=HYBRID, token=token), "cloud")
        cloud.assert_called_once_with("حلّل الرسم البياني", token, jpeg=frame)
        cloud.reset_mock()
        self.assertEqual(desktop_answer("اقرأ الشاشة", frame, ocr, True, mode=OFFLINE), "sum = 2 + 3")
        self.assertEqual(desktop_answer("اشرح الكود", frame, ocr, mode=OFFLINE), "local")
        self.assertNotIn("image", local.call_args.kwargs)
        self.assertEqual(desktop_answer("وش المنتج؟", frame, ocr, mode=FULL_LOCAL), "local")
        self.assertEqual(local.call_args.kwargs["image"], frame)
        cloud.assert_not_called()
