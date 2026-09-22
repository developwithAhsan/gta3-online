from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path("web")
BLOG = ROOT / "blog"
BASE = "https://developwithahsan.github.io/gta3-online"

errors = []

def require(text, needle, label, path):
    if needle not in text:
        errors.append(f"{path}: missing {label}")

blog_pages = sorted(p for p in BLOG.glob("*.html") if p.name != "index.html")
for path in blog_pages:
    text = path.read_text(encoding="utf-8")
    require(text, "<title>", "title", path)
    require(text, 'name="description"', "meta description", path)
    require(text, 'name="robots"', "robots meta", path)
    require(text, 'rel="canonical"', "canonical", path)
    require(text, 'property="og:title"', "Open Graph title", path)
    require(text, 'property="og:description"', "Open Graph description", path)
    require(text, 'property="og:image"', "Open Graph image", path)
    require(text, '"@type":"BlogPosting"', "BlogPosting schema", path)
    require(text, '"@type":"BreadcrumbList"', "Breadcrumb schema", path)
    require(text, 'class="blog-hero-image"', "hero image", path)
    require(text, 'alt="', "image alt text", path)
    require(text, 'class="blog-related"', "internal related links", path)

    canon = re.search(r'<link\s+rel="canonical"\s+href="([^"]+)"', text)
    expected = f"{BASE}/blog/{path.name}"
    if not canon or canon.group(1) != expected:
        errors.append(f"{path}: canonical mismatch; expected {expected}")

sitemap_path = ROOT / "sitemap.xml"
tree = ET.parse(sitemap_path)
ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
urls = {n.text for n in tree.findall(".//s:loc", ns) if n.text}
for path in blog_pages:
    expected = f"{BASE}/blog/{path.name}"
    if expected not in urls:
        errors.append(f"sitemap.xml: missing {expected}")

robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
if f"Sitemap: {BASE}/sitemap.xml" not in robots:
    errors.append("robots.txt: sitemap declaration missing or wrong")

for test_page in ["audiotest.html", "rendertest.html"]:
    text = (ROOT / test_page).read_text(encoding="utf-8")
    if 'name="robots" content="noindex,nofollow"' not in text:
        errors.append(f"{test_page}: diagnostic page must be noindex,nofollow")

if len(blog_pages) < 28:
    errors.append(f"Expected at least 28 blog articles, found {len(blog_pages)}")

if errors:
    print("SEO audit failed:")
    for err in errors:
        print(" -", err)
    sys.exit(1)

print(f"SEO audit passed: {len(blog_pages)} articles, {len(urls)} sitemap URLs")
