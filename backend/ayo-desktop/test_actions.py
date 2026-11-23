import unittest
from actions import validate


class ActionTests(unittest.TestCase):
    def test_supported(self):
        plan = [{"tool":"open_app", "value":"calculator"}]
        self.assertEqual(validate(plan), plan)

    def test_rejects_extra_arguments_and_paths(self):
        for plan in ([{"tool":"open_app","value":"powershell"}],
                     [{"tool":"open_folder","value":"../other"}],
                     [{"tool":"search_web","value":"q","command":"extra"}], []):
            with self.assertRaises(ValueError):
                validate(plan)
