#!/usr/bin/env python3
"""Build dist/index.html from the site's design and script plus data/projects.json (made by scanner/scan.py)."""
import json
from pathlib import Path

root = Path(__file__).parent
site = root / "site"
data_file = root / "data" / "projects.json"
data = json.loads(data_file.read_text())
icons = (site / "icons.html").read_text().replace(
    "</svg>", '<symbol id="x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol></svg>', 1)
app = (site / "app.js").read_text()
app = app.replace("/*DATA*/null", json.dumps(data).replace("</", "<\\/"))
app = app.replace("/*ICONS*/{}", (site / "stack-icons.json").read_text())
css = (site / "board.css").read_text().replace("#FAFAF8", "var(--head)") + "\n" + (site / "extra.css").read_text()

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#17181B" media="(prefers-color-scheme: dark)">
<title>Dashboard</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%2317181B'/%3E%3Crect x='8' y='8' width='8' height='8' rx='2' fill='%23fff'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<style>
{css}
</style>
</head>
<body>
{icons}
<div class="app">
  <aside class="side" id="side"></aside>
  <div class="main">
    <div class="phone-top"><div class="logo"><b><i></i></b>Dashboard</div><button class="icon-btn" data-menu aria-label="Open menu"><svg class="i"><use href="#menu"/></svg></button></div>
    <header class="top">
      <label class="search"><svg class="i"><use href="#search"/></svg><input id="q" type="search" placeholder="Search projects, services, stack" autocomplete="off" aria-label="Search projects"><kbd>⌘K</kbd></label>
      <div class="grow"></div>
      <button class="btn primary" data-capture><svg class="i"><use href="#bulb"/></svg>Capture idea<kbd>I</kbd></button>
    </header>
    <div class="content">
      <label class="phone-search"><svg class="i"><use href="#search"/></svg><input id="q2" type="search" placeholder="Search projects, services, stack" autocomplete="off" aria-label="Search projects"></label>
      <div id="view" style="display:contents"></div>
    </div>
  </div>
</div>
<button class="fab" data-capture aria-label="Capture idea"><svg class="i"><use href="#plus"/></svg></button>
<div id="overlay"></div>
<script>
{app}
</script>
</body>
</html>
"""
out = root / "dist"
out.mkdir(exist_ok=True)
(out / "index.html").write_text(page)
(out / "robots.txt").write_text("User-agent: *\nDisallow: /\n")
print(f"dist/index.html, {len(page) // 1024} KB")
