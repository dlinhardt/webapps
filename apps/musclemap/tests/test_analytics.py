import unittest
from pathlib import Path


INDEX_HTML = Path(__file__).parents[1] / "web" / "index.html"


class AnalyticsMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = INDEX_HTML.read_text(encoding="utf-8")

    def test_app_source_has_no_local_analytics_bootstrap(self):
        self.assertNotIn("googletagmanager.com/gtag/js", self.html)
        self.assertNotIn("gtag('config'", self.html)

    def test_cloudflare_analytics_is_absent(self):
        self.assertNotIn("static.cloudflareinsights.com", self.html)
        self.assertNotIn("data-cf-beacon", self.html)
        self.assertNotIn("Cloudflare Web Analytics", self.html)

    def test_privacy_disclosure_is_current(self):
        self.assertIn("hosting layer records page views only", self.html)
        self.assertIn("Do Not Track or Global Privacy Control", self.html)
        self.assertIn("does not send custom events", self.html)
        self.assertIn(
            "patient images, voxel values, screenshots, generated segmentations, "
            "filenames, or analysis results to Google Analytics",
            self.html,
        )


if __name__ == "__main__":
    unittest.main()
