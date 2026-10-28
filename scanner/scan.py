#!/usr/bin/env python3
"""Scan ~/Projects and write data/projects.json for the dashboard.

Reads code, git and DNS. Never reads secret values: from .env files only the variable names are kept.
Usage: python3 scan.py [projects_dir] [out.json]
"""
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "~/Projects").expanduser()
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "data" / "projects.json")
TODAY = date.today()
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", ".next", "dist", "build", ".astro", ".gradle",
             ".kotlin", ".worktrees", ".playwright-mcp", "test-results", "logs", "screenshots", ".turbo", ".cache", "models"}
CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".astro", ".py", ".html", ".kt", ".kts", ".toml", ".yml",
            ".yaml", ".json", ".vue", ".svelte"}

# name: (category, what it does, dashboard url, signals)
# signals: deps (package names, lowercase), env (variable-name prefixes), code (regex in source), files (paths)
SERVICES = {
    "Vercel": ("Hosting and data", "Hosts the site", "https://vercel.com/dashboard",
               {"files": ["vercel.json"], "deps": ["@vercel/analytics", "@vercel/og"], "env": ["VERCEL_"]}),
    "Cloudflare Pages": ("Hosting and data", "Hosts the site", "https://dash.cloudflare.com/?to=/:account/pages",
                         {"code": [r"CF_PAGES", r"\.pages\.dev"], "files": ["wrangler.toml"]}),
    "Netlify": ("Hosting and data", "Hosts the site", "https://app.netlify.com", {"files": ["netlify.toml"]}),
    "Supabase": ("Hosting and data", "Database and user login", "https://supabase.com/dashboard/projects",
                 {"deps": ["@supabase/supabase-js", "@supabase/ssr", "supabase"], "env": ["SUPABASE_", "NEXT_PUBLIC_SUPABASE_"]}),
    "Prisma": ("Hosting and data", "Database access layer", None, {"files": ["prisma/schema.prisma"], "deps": ["prisma", "@prisma/client"]}),
    "Firebase": ("Hosting and data", "Backend and auth", "https://console.firebase.google.com", {"deps": ["firebase", "firebase-admin"], "env": ["FIREBASE_"]}),
    "MongoDB": ("Hosting and data", "Database", "https://cloud.mongodb.com", {"deps": ["mongodb", "mongoose", "pymongo"], "env": ["MONGODB_", "MONGO_"]}),
    "Upstash Redis": ("Hosting and data", "Cache and queues", "https://console.upstash.com", {"deps": ["@upstash/redis"], "env": ["UPSTASH_"]}),
    "Docker": ("Hosting and data", "Runs the app in containers", None, {"files": ["Dockerfile", "docker-compose.yml"]}),
    "Stripe": ("Payments, email and analytics", "Payments", "https://dashboard.stripe.com", {"deps": ["stripe", "@stripe/stripe-js"], "env": ["STRIPE_"]}),
    "Razorpay": ("Payments, email and analytics", "Payments", "https://dashboard.razorpay.com", {"deps": ["razorpay"], "env": ["RAZORPAY_"]}),
    "Resend": ("Payments, email and analytics", "Sends email", "https://resend.com/emails", {"deps": ["resend"], "env": ["RESEND_"]}),
    "SendGrid": ("Payments, email and analytics", "Sends email", "https://app.sendgrid.com", {"deps": ["@sendgrid/mail", "sendgrid"], "env": ["SENDGRID_"]}),
    "Gmail SMTP": ("Payments, email and analytics", "Sends email through Gmail", "https://myaccount.google.com/apppasswords", {"env": ["GMAIL_", "SMTP_"]}),
    "Umami": ("Payments, email and analytics", "Privacy-friendly page views", "https://cloud.umami.is/websites", {"code": [r"umami\.is", r"data-website-id"]}),
    "Plausible": ("Payments, email and analytics", "Page views", "https://plausible.io/sites", {"code": [r"plausible\.io/js"]}),
    "PostHog": ("Payments, email and analytics", "Product analytics", "https://app.posthog.com", {"deps": ["posthog-js", "posthog-node", "posthog"], "env": ["POSTHOG_", "NEXT_PUBLIC_POSTHOG_"]}),
    "Google Analytics": ("Payments, email and analytics", "Page views", "https://analytics.google.com", {"code": [r"googletagmanager\.com/gtag"]}),
    "Sentry": ("Payments, email and analytics", "Error tracking", "https://sentry.io", {"deps": ["@sentry/nextjs", "@sentry/node", "sentry-sdk"], "env": ["SENTRY_"]}),
    "Clerk": ("Payments, email and analytics", "User login", "https://dashboard.clerk.com", {"deps": ["@clerk/nextjs"], "env": ["CLERK_"]}),
    "Anthropic API": ("AI", "Claude models", "https://console.anthropic.com/settings/usage", {"deps": ["@anthropic-ai/sdk", "anthropic", "langchain-anthropic"], "env": ["ANTHROPIC_"]}),
    "OpenAI API": ("AI", "OpenAI models", "https://platform.openai.com/usage", {"deps": ["openai", "langchain-openai", "@ai-sdk/openai"], "env": ["OPENAI_"]}),
    "Google Gemini": ("AI", "Gemini models", "https://aistudio.google.com/apikey", {"deps": ["google-generativeai", "google-genai", "@google/generative-ai"], "env": ["GEMINI_", "GOOGLE_API_KEY"]}),
    "Groq": ("AI", "Fast model inference", "https://console.groq.com", {"deps": ["groq", "langchain-groq"], "env": ["GROQ_"]}),
    "ElevenLabs": ("AI", "Voice generation", "https://elevenlabs.io/app", {"deps": ["elevenlabs"], "env": ["ELEVENLABS_", "ELEVEN_"]}),
    "Replicate": ("AI", "Hosted models", "https://replicate.com/account", {"deps": ["replicate"], "env": ["REPLICATE_"]}),
    "Hugging Face": ("AI", "Models and datasets", "https://huggingface.co/settings/tokens", {"deps": ["@huggingface/transformers", "transformers", "huggingface_hub"], "env": ["HF_", "HUGGINGFACE_"]}),
    "Instagram Graph API": ("Social and messaging", "Posts to Instagram", "https://developers.facebook.com/apps", {"env": ["INSTAGRAM_", "IG_", "META_", "FB_"]}),
    "LinkedIn": ("Social and messaging", "LinkedIn automation", "https://www.linkedin.com/developers/apps", {"env": ["LINKEDIN_"]}),
    "Telegram Bot": ("Social and messaging", "Bot messages", "https://t.me/BotFather", {"deps": ["python-telegram-bot", "telegraf"], "env": ["TELEGRAM_"]}),
    "Slack": ("Social and messaging", "Slack messages", "https://api.slack.com/apps", {"deps": ["@slack/web-api", "slack_sdk"], "env": ["SLACK_"]}),
    "Twilio": ("Social and messaging", "SMS and WhatsApp", "https://console.twilio.com", {"deps": ["twilio"], "env": ["TWILIO_"]}),
    "Google Sheets": ("Social and messaging", "Reads and writes a Google Sheet", "https://console.cloud.google.com/apis/credentials", {"deps": ["gspread", "googleapis"], "env": ["GOOGLE_SHEET", "SPREADSHEET_", "GOOGLE_SERVICE_ACCOUNT"]}),
    "GitHub Actions": ("Code", "Runs CI on every push", None, {"files": [".github/workflows"]}),
}

STACK = {  # dependency -> label
    "next": "Next.js", "astro": "Astro", "react": "React", "vue": "Vue", "svelte": "Svelte", "tailwindcss": "Tailwind",
    "typescript": "TypeScript", "prisma": "Prisma", "drizzle-orm": "Drizzle", "remotion": "Remotion", "vitest": "Vitest",
    "@playwright/test": "Playwright", "playwright": "Playwright", "express": "Express", "fastapi": "FastAPI", "flask": "Flask",
    "django": "Django", "langchain": "LangChain", "langgraph": "LangGraph", "selenium": "Selenium", "pandas": "pandas",
    "streamlit": "Streamlit", "mcp": "MCP", "fastmcp": "MCP", "python-docx": "python-docx", "onnxruntime-web": "ONNX Runtime",
    "@huggingface/transformers": "Transformers.js", "shadcn": "shadcn/ui", "zod": "Zod", "uvicorn": "Uvicorn",
}


# How a project is built, layer by layer: dependency -> (layer, name, what it does here)
LAYERS = ["App", "Language", "Styling", "Backend", "Data", "AI and ML", "Automation", "Testing", "Hosting and deploy"]
BUILT = {
    "next": ("App", "Next.js", "React framework, pages and API routes"), "astro": ("App", "Astro", "Static site generator"),
    "react": ("App", "React", "UI components"), "vue": ("App", "Vue", "UI components"), "svelte": ("App", "Svelte", "UI components"),
    "remotion": ("App", "Remotion", "Renders videos from React"), "streamlit": ("App", "Streamlit", "Python web UI"),
    "compose": ("App", "Jetpack Compose", "Android UI"), "camerax": ("App", "CameraX", "Camera capture"), "coil": ("App", "Coil", "Image loading"),
    "tailwindcss": ("Styling", "Tailwind CSS", "Utility-first styling"), "shadcn": ("Styling", "shadcn/ui", "Component library"),
    "@radix-ui/react-slot": ("Styling", "Radix UI", "Accessible primitives"),
    "fastapi": ("Backend", "FastAPI", "Python API server"), "flask": ("Backend", "Flask", "Python web server"), "django": ("Backend", "Django", "Python web framework"),
    "express": ("Backend", "Express", "Node API server"), "uvicorn": ("Backend", "Uvicorn", "Runs the API server"),
    "mcp": ("Backend", "MCP", "Model Context Protocol server"), "fastmcp": ("Backend", "FastMCP", "Model Context Protocol server"),
    "next-auth": ("Backend", "NextAuth", "Login and sessions"), "zod": ("Backend", "Zod", "Input validation"),
    "prisma": ("Data", "Prisma", "Database schema and queries"), "drizzle-orm": ("Data", "Drizzle", "Database schema and queries"),
    "room": ("Data", "Room", "On-device database"), "pandas": ("Data", "pandas", "Data wrangling"),
    "langchain": ("AI and ML", "LangChain", "LLM chains and tools"), "langgraph": ("AI and ML", "LangGraph", "Agent workflows"),
    "@huggingface/transformers": ("AI and ML", "Transformers.js", "Runs models in the browser"),
    "onnxruntime-web": ("AI and ML", "ONNX Runtime Web", "Model inference in the browser"),
    "playwright": ("Automation", "Playwright", "Browser automation"), "selenium": ("Automation", "Selenium", "Browser automation"),
    "python-docx": ("Automation", "python-docx", "Reads and writes Word files"),
    "vitest": ("Testing", "Vitest", "Unit tests"), "@playwright/test": ("Testing", "Playwright Test", "End-to-end tests"),
    "jest": ("Testing", "Jest", "Unit tests"), "pytest": ("Testing", "pytest", "Python tests"), "eslint": ("Testing", "ESLint", "Linting"),
}


def pkg_versions(root):
    versions = {}
    for pj in [root / "package.json"] + list(root.glob("*/package.json"))[:6]:
        try:
            j = json.loads(read(pj))
            for k in ("dependencies", "devDependencies"):
                for d, v in j.get(k, {}).items():
                    m = re.search(r"\d+(?:\.\d+)?", str(v))
                    versions.setdefault(d.lower(), m.group(0) if m else "")
        except Exception:
            pass
    return versions


def build_info(root, deps, services):
    versions = pkg_versions(root)
    gradle = " ".join(read(f, 100_000) for f in [root / "app" / "build.gradle.kts", root / "build.gradle.kts", root / "gradle" / "libs.versions.toml"])
    for lib in ("compose", "room", "camerax", "coil"):
        if lib in gradle.lower():
            deps = deps | {lib}
    layers = {l: [] for l in LAYERS}
    seen = set()
    for dep in sorted(deps):
        if dep in BUILT and BUILT[dep][1] not in seen:
            layer, name, role = BUILT[dep]
            if dep == "playwright" and "@playwright/test" in deps:
                continue
            seen.add(name)
            v = versions.get(dep, "")
            layers[layer].append({"name": name + (f" {v.split('.')[0]}" if v and dep in ("next", "astro", "react", "tailwindcss", "vue") else ""), "role": role})
    lang = []
    if "typescript" in deps or (root / "tsconfig.json").exists():
        lang.append({"name": "TypeScript", "role": "Typed JavaScript"})
    elif (root / "package.json").exists():
        lang.append({"name": "JavaScript", "role": ""})
    if (root / "requirements.txt").exists() or (root / "pyproject.toml").exists() or list(root.glob("*/requirements.txt")) or list(root.glob("*.py")):
        pv = read(root / ".python-version").strip()
        lang.append({"name": "Python" + (f" {pv}" if pv else ""), "role": ""})
    if gradle.strip():
        lang.append({"name": "Kotlin", "role": "Android app"})
    layers["Language"] = lang + layers["Language"]
    for s in services:
        if s["name"] in seen:
            continue
        if s["category"] == "Hosting and data" and s["name"] in ("Vercel", "Cloudflare Pages", "Netlify", "Docker"):
            layers["Hosting and deploy"].append({"name": s["name"], "role": s["what"]})
        elif s["category"] == "Hosting and data":
            layers["Data"].append({"name": s["name"], "role": s["what"]})
        elif s["category"] == "AI":
            layers["AI and ML"].append({"name": s["name"], "role": s["what"]})
        elif s["name"] == "GitHub Actions":
            layers["Hosting and deploy"].append({"name": s["name"], "role": s["what"]})
    built = [{"layer": l, "items": items} for l, items in layers.items() if items]

    # How to run it, from the project's own scripts.
    commands = []
    def node_cmds(folder, prefix=""):
        try:
            scripts = json.loads(read(folder / "package.json")).get("scripts", {})
        except Exception:
            return
        pm = "pnpm" if (folder / "pnpm-lock.yaml").exists() and not (folder / "package-lock.json").exists() else "yarn" if (folder / "yarn.lock").exists() else "npm"
        for key, label in (("dev", "Run locally"), ("build", "Build"), ("test", "Test"), ("test:e2e", "End-to-end tests"), ("start", "Start")):
            if key in scripts and len(commands) < 6:
                cmd = f"{pm} run {key}" if key not in ("test", "start") or pm != "npm" else f"npm {key}"
                commands.append({"label": label + (f" ({folder.name})" if prefix else ""), "cmd": prefix + cmd})
    node_cmds(root)
    for sub in sorted(root.glob("*/package.json"))[:3]:
        if "node_modules" not in str(sub):
            node_cmds(sub.parent, f"cd {sub.parent.name} && ")
    if (root / "docker-compose.yml").exists():
        commands.append({"label": "Run with Docker", "cmd": "docker compose up"})
    if (root / "uv.lock").exists():
        main = "main.py" if (root / "main.py").exists() else ""
        commands.append({"label": "Run locally", "cmd": f"uv run {main}".strip()})
    elif (root / "requirements.txt").exists():
        commands.append({"label": "Install", "cmd": "pip install -r requirements.txt"})
    if (root / "gradlew").exists():
        commands.append({"label": "Build the app", "cmd": "./gradlew assembleDebug"})
    return built, commands


def sh(args, cwd=None, timeout=20):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def read(p, limit=400_000):
    try:
        with open(p, encoding="utf-8", errors="ignore") as f:
            return f.read(limit)
    except Exception:
        return ""


def walk(root, max_files=4000):
    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".") or d in (".github", ".claude")]
        for f in filenames:
            yield Path(dirpath) / f
            n += 1
            if n >= max_files:
                return


def deps_of(root):
    deps = set()
    for pj in [root / "package.json"] + list(root.glob("*/package.json"))[:6]:
        try:
            j = json.loads(read(pj))
            for k in ("dependencies", "devDependencies"):
                deps |= {d.lower() for d in j.get(k, {})}
        except Exception:
            pass
    for req in list(root.glob("requirements*.txt")) + list(root.glob("*/requirements*.txt"))[:6]:
        for line in read(req).splitlines():
            m = re.match(r"\s*([A-Za-z0-9_.\-\[\]]+)", line)
            if m and not line.strip().startswith("#"):
                deps.add(re.sub(r"\[.*\]", "", m.group(1)).lower())
    for pp in [root / "pyproject.toml"] + list(root.glob("*/pyproject.toml"))[:6]:
        for m in re.finditer(r'"([A-Za-z0-9_.\-]+)\s*(?:[<>=~!].*)?"', read(pp)):
            deps.add(m.group(1).lower())
    if (root / "build.gradle.kts").exists() or list(root.glob("app/build.gradle.kts")):
        deps.add("android")
    return deps


def env_names(root):
    """Variable NAMES only. Values are never read into memory beyond the current line and never stored."""
    names = set()
    for f in list(root.glob(".env*")) + list(root.glob("*/.env*"))[:10]:
        if f.is_file():
            for line in read(f, 100_000).splitlines():
                m = re.match(r"\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=", line)
                if m:
                    names.add(m.group(1))
    return names


def git_info(path):
    if not sh(["git", "rev-parse", "--is-inside-work-tree"], cwd=path):
        return None
    days = sh(["git", "log", "--all", "--since=14.days", "--format=%ad", "--date=short"], cwd=path).splitlines()
    activity = [days.count((TODAY - timedelta(days=13 - i)).isoformat()) for i in range(14)]
    last = sh(["git", "log", "--all", "-1", "--format=%cI"], cwd=path)
    commits = []
    raw = sh(["git", "log", "--all", "-6", "--format=@@%cI|%s", "--shortstat"], cwd=path)
    for block in raw.split("@@")[1:]:
        lines = [l for l in block.strip().splitlines() if l.strip()]
        when, _, msg = lines[0].partition("|")
        stat = lines[1].strip() if len(lines) > 1 else ""
        files = re.search(r"(\d+) files? changed", stat)
        ins = re.search(r"(\d+) insertion", stat)
        dele = re.search(r"(\d+) deletion", stat)
        commits.append({"when": when, "msg": msg, "files": int(files.group(1)) if files else 0,
                        "add": int(ins.group(1)) if ins else 0, "del": int(dele.group(1)) if dele else 0})
    week = []
    raw = sh(["git", "log", "--all", "--since=7.days", "--format=@@%cI|%s", "--shortstat"], cwd=path)
    for block in raw.split("@@")[1:]:
        lines = [l for l in block.strip().splitlines() if l.strip()]
        when, _, msg = lines[0].partition("|")
        stat = lines[1] if len(lines) > 1 else ""
        ins = re.search(r"(\d+) insertion", stat)
        dele = re.search(r"(\d+) deletion", stat)
        week.append({"when": when, "msg": msg, "add": int(ins.group(1)) if ins else 0, "del": int(dele.group(1)) if dele else 0})
    remote = sh(["git", "remote", "get-url", "origin"], cwd=path)
    first = sh(["git", "log", "--reverse", "--format=%cI"], cwd=path).split("\n")[0]
    return {"activity": activity, "last": last, "commits": commits, "week": week, "remote": remote, "first": first}


def worktree_state(path):
    branch = sh(["git", "branch", "--show-current"], cwd=path) or "detached"
    dirty = len([l for l in sh(["git", "status", "--porcelain"], cwd=path).splitlines() if l.strip()])
    return branch, dirty


def last_mtime(root):
    newest = 0
    for f in walk(root, 3000):
        if f.suffix in CODE_EXT or f.suffix in {".md", ".txt"}:
            try:
                newest = max(newest, f.stat().st_mtime)
            except OSError:
                pass
    return datetime.fromtimestamp(newest, timezone.utc).isoformat() if newest else ""


def parse_project_md(text):
    """PROJECT.md: 'Status:', 'Next:', 'Blocked:' lines, then '## Open questions', '## Decisions', '## Accounts' lists."""
    out = {"status": "", "next": "", "blocked": "", "domain": "", "open": [], "decisions": [], "accounts": {}}
    section = None
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r"(?i)(status|next|blocked|domain)\s*:\s*(.+)", s)
        if m and section in (None, "title"):
            out[m.group(1).lower()] = m.group(2).strip()
            continue
        h = re.match(r"(#+)\s*(.+)", s)
        if h and len(h.group(1)) == 1 and section is None:  # the "# Project name" title keeps the fields below it
            section = "title"
            continue
        h = re.match(r"#+\s*(.+)", s)
        if h:
            t = h.group(1).lower()
            section = "open" if "open" in t or "question" in t else "decisions" if "decision" in t else "accounts" if "account" in t or "service" in t else "other"
            continue
        item = re.match(r"[-*]\s+(?:\[( |x)\]\s*)?(.+)", s)
        if item and section in ("open", "decisions"):
            out[section].append(item.group(2).strip())
        elif item and section == "accounts":
            name, _, rest = item.group(2).partition(":")
            out["accounts"][name.strip().lower()] = rest.strip()
    return out


def describe(root):
    for name in ("README.md", "PRODUCT.md", "CLAUDE.md"):
        text = read(root / name, 20_000)
        for para in re.split(r"\n\s*\n", text):
            p = " ".join(l.strip() for l in para.splitlines() if l.strip() and not l.strip().startswith(("#", "!", "<", "|", "```", "-", ">")))
            p = re.sub(r"\*\*|`|\[([^\]]+)\]\([^)]+\)", lambda m: m.group(1) or "", p)
            if len(p) > 40 and not p.rstrip().endswith(":") and not p.lower().startswith(("this is a next.js project", "this project was bootstrapped")):
                return (p[:220].rsplit(" ", 1)[0] + "…") if len(p) > 220 else p
    return ""


def domain_info(domain):
    info = {"domain": domain, "registrar": "", "expires": "", "dns": ""}
    ns = sh(["dig", "+short", "NS", domain], timeout=10).lower()
    if "cloudflare" in ns:
        info["dns"] = "Cloudflare"
    elif "vercel" in ns:
        info["dns"] = "Vercel"
    elif "domaincontrol.com" in ns:
        info["dns"] = "GoDaddy"
    elif "registrar-servers.com" in ns:
        info["dns"] = "Namecheap"
    elif "awsdns" in ns:
        info["dns"] = "AWS Route 53"
    elif ns:
        info["dns"] = ns.split()[0].rstrip(".")
    w = sh(["whois", domain], timeout=20)
    r = re.search(r"Registrar:\s*(.+)", w)
    e = re.search(r"(?:Registry Expiry Date|Registrar Registration Expiration Date|Expiration Date):\s*(\S+)", w)
    if r:
        info["registrar"] = r.group(1).strip()
    if e:
        info["expires"] = e.group(1)[:10]
    return info


def find_domain(root, pmd):
    if pmd.get("domain"):
        return pmd["domain"].replace("https://", "").replace("http://", "").strip("/")
    # Only sources that name this project's own domain. Docs mention too many other sites to guess from.
    cname = read(root / "public" / "CNAME").strip() or read(root / "CNAME").strip()
    if cname:
        return cname.split()[0]
    for cfg in ("astro.config.mjs", "astro.config.ts", "next.config.mjs", "next.config.ts", "package.json"):
        m = re.search(r"(?:site|homepage)['\"]?\s*:\s*['\"]https?://([a-z0-9.-]+)", read(root / cfg, 50_000))
        if m and not re.search(r"example|localhost|pages\.dev|vercel\.app|netlify\.app|github\.io", m.group(1)):
            return m.group(1)
    return ""


def scan_project(main, worktrees, scheduled_notes):
    pmd = parse_project_md(read(main / "PROJECT.md"))
    g = git_info(main)
    remote = g["remote"] if g else ""
    repo_name = re.sub(r"\.git$", "", remote.rstrip("/").split("/")[-1]) if remote else ""
    name = repo_name if repo_name and repo_name.lower() != main.name.lower() else main.name

    deps = set()
    envs = set()
    for wt in [main] + [w["path"] for w in worktrees]:
        deps |= deps_of(Path(wt))
        envs |= env_names(Path(wt))
    code_hits = set()
    patterns = {svc: [re.compile(p) for p in sig.get("code", [])] for svc, (_, _, _, sig) in SERVICES.items() if sig.get("code")}
    env_ref = re.compile(r"(?:process\.env\.|import\.meta\.env\.|os\.environ(?:\.get)?\(?\[?['\"]|getenv\(['\"])([A-Z][A-Z0-9_]+)")
    for f in walk(main):
        if f.suffix not in CODE_EXT or f.name in ("package-lock.json", "pnpm-lock.yaml", "uv.lock"):
            continue
        text = read(f, 300_000)
        for svc, pats in patterns.items():
            if svc not in code_hits and any(p.search(text) for p in pats):
                code_hits.add(svc)
        envs |= set(env_ref.findall(text))

    services = []
    for svc, (cat, what, url, sig) in SERVICES.items():
        why = ""
        if any(d in deps for d in sig.get("deps", [])):
            why = "Found in code"
        elif svc in code_hits:
            why = "Found in code"
        elif any((main / p).exists() for p in sig.get("files", [])):
            why = "Found in code"
        elif any(n.startswith(tuple(sig.get("env", []))) for n in envs) and sig.get("env"):
            why = "Found in settings"
        if why:
            keys = sorted(n for n in envs if sig.get("env") and n.startswith(tuple(sig["env"])))
            services.append({"name": svc, "category": cat, "what": what, "url": url, "source": why, "keys": keys[:3]})
    if remote and "github.com" in remote:
        slug = re.sub(r"\.git$", "", remote.split("github.com")[-1].lstrip(":/"))
        services.append({"name": "GitHub", "category": "Code", "what": f"Repo {slug}", "url": f"https://github.com/{slug}",
                         "source": "Found in git", "keys": []})

    domain = find_domain(main, pmd)
    if not domain:
        for note in scheduled_notes:
            if str(main) in note:
                m = re.search(r"\b([a-z0-9-]+\.(?:com|app|dev|io|in))\b", note)
                if m:
                    domain = m.group(1)
                    break
    dinfo = domain_info(domain) if domain else None
    if dinfo:
        if dinfo["registrar"]:
            reg = dinfo["registrar"]
            short = "GoDaddy" if "godaddy" in reg.lower() else "Namecheap" if "namecheap" in reg.lower() else "Cloudflare Registrar" if "cloudflare" in reg.lower() else "Google Domains" if "google" in reg.lower() else "Hostinger" if "hostinger" in reg.lower() else reg
            url = {"GoDaddy": f"https://dcc.godaddy.com/control/portfolio/{domain}/settings", "Namecheap": "https://ap.www.namecheap.com/domains/list/",
                   "Cloudflare Registrar": "https://dash.cloudflare.com/?to=/:account/domains"}.get(short)
            what = f"Registrar for {domain}." + (f" Expires {datetime.fromisoformat(dinfo['expires']).strftime('%b %-d, %Y')}." if dinfo["expires"] else "")
            services.insert(0, {"name": short, "category": "Domain and DNS", "what": what, "url": url, "source": "Found in domain lookup",
                                "keys": [], "expires": dinfo["expires"]})
        if dinfo["dns"] and services and services[0]["name"] == dinfo["dns"]:  # registrar also runs DNS: one row
            services[0]["what"] += " DNS is hosted here too."
        elif dinfo["dns"]:
            url = f"https://dash.cloudflare.com/?to=/:account/{domain}/dns" if dinfo["dns"] == "Cloudflare" else None
            services.insert(1 if dinfo["registrar"] else 0, {"name": dinfo["dns"] if dinfo["dns"] != "Cloudflare" else "Cloudflare DNS",
                             "category": "Domain and DNS", "what": f"DNS for {domain}. Nameservers point here.", "url": url,
                             "source": "Found in DNS", "keys": []})
    # Services listed under "## Accounts" in PROJECT.md that nothing detected: add them, with the note as what they do.
    found = {s["name"].lower() for s in services}
    for key, note in pmd["accounts"].items():
        if key in found or any(key in f or f in key for f in found):
            continue
        known = next(((n, v) for n, v in SERVICES.items() if n.lower() == key or n.lower().startswith(key)), None)
        svc_name, (cat, what, url, _) = known if known else (key.title(), ("Other", "", None, {}))
        services.append({"name": svc_name, "category": cat, "what": note or what, "url": url, "source": "You added", "keys": [], "manual": True})
    for s in services:  # Account, plan and cost come only from what the user told Claude in PROJECT.md.
        if s.get("manual"):
            s["account"] = ""
            continue
        s["account"] = pmd["accounts"].get(s["name"].lower(), "") or next((v for k, v in pmd["accounts"].items() if k in s["name"].lower()), "")

    stack = sorted({STACK[d] for d in deps if d in STACK})
    if "android" in deps:
        stack = ["Android", "Kotlin"] + stack
    if any(d in deps for d in ("fastapi", "flask", "django", "requests", "langchain", "selenium", "pandas")) or (main / "requirements.txt").exists() or (main / "pyproject.toml").exists():
        stack = ["Python"] + stack

    built, commands = build_info(main, deps, services)
    last = g["last"] if g and g["last"] else last_mtime(main)
    idle = (TODAY - datetime.fromisoformat(last).date()).days if last else 999
    branch, dirty = worktree_state(main) if g else ("", 0)
    wts = []
    for w in worktrees:
        b, d = worktree_state(w["path"])
        wts.append({"folder": Path(w["path"]).name, "branch": b, "dirty": d})
    status = "paused" if pmd["status"].lower().startswith("pause") else "active" if idle <= 7 else "quiet" if idle <= 30 else "dormant"

    return {
        "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"), "name": name, "folder": str(main).replace(str(Path.home()), "~"),
        "description": describe(main), "status": status, "blocked": pmd["blocked"], "next": pmd["next"],
        "open": pmd["open"], "decisions": pmd["decisions"], "hasProjectMd": (main / "PROJECT.md").exists(),
        "idle": idle, "last": last, "first": g["first"] if g else "", "git": bool(g), "branch": branch, "dirty": dirty + sum(w["dirty"] for w in wts),
        "worktrees": wts, "activity": g["activity"] if g else [0] * 14, "commits": g["commits"] if g else [],
        "week": g["week"] if g else [], "stack": stack, "services": services, "domain": domain,
        "expires": dinfo["expires"] if dinfo else "",
        "built": built, "commands": commands,
    }


def main():
    notes = [read(p) for p in Path("~/.claude/scheduled-tasks").expanduser().glob("*/SKILL.md")]
    dirs = [d for d in sorted(ROOT.iterdir()) if d.is_dir() and not d.name.startswith(".")]
    worktree_of = {}
    for d in dirs:
        gf = d / ".git"
        if gf.is_file():
            m = re.search(r"gitdir:\s*(.+)/\.git/worktrees/", read(gf))
            if m:
                worktree_of[d] = Path(m.group(1))
    # data/untracked.json: projects the user stopped tracking on the dashboard, copied from the site's storage by
    # deploy.sh. Either a list of ids or {"items": [{"id": ...}]}. Their folders are skipped entirely.
    ignored = set()
    try:
        here = Path(__file__).resolve().parent
        src = next((f for f in (here.parent / "data" / "untracked.json", here / "untracked.json") if f.exists()), None)
        raw = json.loads(src.read_text()) if src else []
        items = raw.get("items", []) if isinstance(raw, dict) else raw
        ignored = {(i.get("id") if isinstance(i, dict) else i) for i in items}
    except (OSError, ValueError, AttributeError):
        pass
    projects = []
    for d in dirs:
        if d in worktree_of:
            continue
        wts = [{"path": w} for w, parent in worktree_of.items() if parent == d]
        if re.sub(r"[^a-z0-9]+", "-", d.name.lower()).strip("-") in ignored:
            continue
        p = scan_project(d, wts, notes)
        if p["id"] not in ignored:
            projects.append(p)
    order = {"active": 0, "paused": 2, "quiet": 1, "dormant": 3}
    projects.sort(key=lambda p: (order[p["status"]], p["idle"]))
    data = {"generated": datetime.now().astimezone().isoformat(timespec="minutes"), "root": str(ROOT).replace(str(Path.home()), "~"), "projects": projects}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1))
    print(f"{len(projects)} projects -> {OUT}")


if __name__ == "__main__":
    main()
