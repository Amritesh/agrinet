#!/usr/bin/env python3
"""Fetch research URLs with curl, convert to text, log retrieval status.
Usage: fetch.py url [url...]  -> appends to logs/research-retrievals.json"""
import sys, os, json, subprocess, hashlib, re, html
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(os.path.dirname(ROOT), "research-retrievals.json")
PYPDF = os.path.expanduser("~/.hermes/cache/scratch/pdfenv/bin/python")
MAXB = 15 * 1024 * 1024

class T(HTMLParser):
    def __init__(s):
        super().__init__(); s.out = []; s.skip = 0
    def handle_starttag(s, t, a):
        if t in ("script", "style", "noscript", "svg"): s.skip += 1
        if t in ("p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "td", "th", "section", "pre"): s.out.append("\n")
    def handle_endtag(s, t):
        if t in ("script", "style", "noscript", "svg") and s.skip: s.skip -= 1
    def handle_data(s, d):
        if not s.skip: s.out.append(d)

def fetch(url):
    h = hashlib.sha1(url.encode()).hexdigest()[:10]
    raw = os.path.join(ROOT, h + ".raw"); txt = os.path.join(ROOT, h + ".txt")
    r = subprocess.run(["curl", "-sL", "--max-time", "45", "-A", "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                        "--max-filesize", str(MAXB), "-o", raw, "-w", "%{http_code} %{content_type} %{size_download}", url],
                       capture_output=True, text=True)
    meta = r.stdout.strip().split(" ")
    code = meta[0] if meta else "000"
    ctype = meta[1] if len(meta) > 1 else ""
    rec = {"url": url, "http": code, "content_type": ctype, "curl_rc": r.returncode, "file": h}
    if r.returncode != 0 or not code.startswith("2") or not os.path.exists(raw):
        rec["status"] = "failed"; rec["error"] = f"curl rc={r.returncode} http={code}"; return rec
    data = open(raw, "rb").read()
    if data[:4] == b"%PDF":
        p = subprocess.run([PYPDF, "-c", "import sys,pypdf;r=pypdf.PdfReader(sys.argv[1]);print('\\n'.join((pg.extract_text() or '') for pg in r.pages))", raw],
                           capture_output=True, text=True)
        text = p.stdout
        if p.returncode: rec["error"] = p.stderr[-300:]
    else:
        t = T(); t.feed(data.decode("utf-8", "replace")); text = "".join(t.out)
    text = re.sub(r"[ \t\r\f\v]+", " ", html.unescape(text))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    open(txt, "w").write(text)
    rec["chars"] = len(text)
    rec["status"] = "ok" if len(text) > 400 else "failed"
    if rec["status"] == "failed": rec["error"] = rec.get("error", "too little text (JS-rendered or blocked?)")
    return rec

if __name__ == "__main__":
    log = []
    if os.path.exists(LOG):
        try:
            d = json.load(open(LOG)); log = d if isinstance(d, list) and d and "status" in d[0] else []
        except Exception: log = []
    for u in sys.argv[1:]:
        rec = fetch(u); log = [x for x in log if x.get("url") != u] + [rec]
        print(rec["status"], rec.get("chars", ""), rec["http"], rec["file"], u, rec.get("error", ""))
    json.dump(log, open(LOG, "w"), indent=1)
