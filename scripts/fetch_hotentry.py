#!/usr/bin/env python3
"""
はてなブックマークのホットエントリーRSSを取得し、data/hotentry-{category}.json に書き出す。
GitHub Actions (.github/workflows/fetch-hotentry.yml) から定期実行される。

クライアント(ブラウザ)側で直接はてなのRSSを取得しようとすると、
- RSSはCORSヘッダーを返さないため fetch() が失敗する
- 無料の公開CORSプロキシは認証必須化・レート制限・不安定で信頼できない
という問題があるため、CI環境(GitHub Actionsのランナー)側で定期的に取得して
リポジトリに同一オリジンの静的JSONとしてコミットし、ブラウザ側はそれを読むだけにする。
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))

NS = {
    "rss": "http://purl.org/rss/1.0/",
    "hatena": "http://www.hatena.ne.jp/info/xmlns#",
}

CATEGORIES = [
    "all",
    "general",
    "social",
    "economics",
    "life",
    "knowledge",
    "it",
    "fun",
    "entertainment",
    "game",
]

USER_AGENT = "hateb-tycoon-bot/1.0 (+https://github.com/gosyujin/hateb-tycoon)"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def fetch_rss(category):
    url = f"https://b.hatena.ne.jp/hotentry/{category}.rss"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.read()


def text_of(item, ns_key, tag):
    el = item.find(f"{{{NS[ns_key]}}}{tag}")
    return el.text.strip() if el is not None and el.text else ""


def safe_hostname(url):
    try:
        return urllib.parse.urlparse(url).netloc
    except ValueError:
        return ""


def parse_items(xml_bytes):
    root = ET.fromstring(xml_bytes)
    items = root.findall(f"{{{NS['rss']}}}item")
    entries = []
    for item in items:
        url = text_of(item, "rss", "link")
        count_text = text_of(item, "hatena", "bookmarkcount")
        entries.append(
            {
                "title": text_of(item, "rss", "title") or "(タイトル不明)",
                "url": url,
                "domain": safe_hostname(url),
                "count": int(count_text) if count_text.isdigit() else 0,
                "entryUrl": text_of(item, "hatena", "bookmarkCommentListPageUrl") or None,
                "screenshot": text_of(item, "hatena", "imageurl") or None,
                "users": [],
            }
        )
    return entries


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    failures = []
    for i, category in enumerate(CATEGORIES):
        if i > 0:
            time.sleep(1)
        try:
            xml_bytes = fetch_rss(category)
            entries = parse_items(xml_bytes)
        except (urllib.error.URLError, ET.ParseError) as e:
            print(f"[warn] {category}: 取得/解析に失敗、既存データを維持します ({e})", file=sys.stderr)
            failures.append(category)
            continue

        out_path = DATA_DIR / f"hotentry-{category}.json"
        out_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[ok] {category}: {len(entries)}件 -> {out_path}")

    now_jst = datetime.now(timezone.utc).astimezone(JST)
    next_estimate_jst = now_jst + timedelta(minutes=30)
    meta = {
        "fetchedAt": now_jst.strftime("%Y-%m-%d %H:%M JST"),
        "nextEstimate": next_estimate_jst.strftime("%Y-%m-%d %H:%M JST"),
    }
    (DATA_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if len(failures) == len(CATEGORIES):
        print("[error] 全カテゴリの取得に失敗しました", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
