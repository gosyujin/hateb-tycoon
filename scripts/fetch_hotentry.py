#!/usr/bin/env python3
"""
はてなブックマークのホットエントリーRSSを取得し、data/hotentry-{category}.json に書き出す。
GitHub Actions (.github/workflows/fetch-hotentry.yml) から定期実行される。

クライアント(ブラウザ)側で直接はてなのRSSを取得しようとすると、
- RSSはCORSヘッダーを返さないため fetch() が失敗する
- 無料の公開CORSプロキシは認証必須化・レート制限・不安定で信頼できない
という問題があるため、CI環境(GitHub Actionsのランナー)側で定期的に取得して
リポジトリに同一オリジンの静的JSONとしてコミットし、ブラウザ側はそれを読むだけにする。

RSSの ?page= / ?of= クエリパラメータはページングとして機能しない(常に現在の
上位30件前後を返すだけ)ことを実機検証済みのため、過去に取得した内容を
「上書き」ではなく「蓄積」することで、時間の経過とともに遡れる件数を増やす。
記事ごとに firstSeenAt(初出日時) / lastSeenAt(最終確認日時) を記録し、
firstSeenAtの新しい順に並べ、件数・保持期間の上限でプルーニングする。
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
    "dc": "http://purl.org/dc/elements/1.1/",
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

MAX_ENTRIES_PER_CATEGORY = 300
RETENTION_DAYS = 14


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
                "description": text_of(item, "rss", "description") or None,
                "hatenaDate": text_of(item, "dc", "date") or None,
                "users": [],
            }
        )
    return entries


def load_existing(out_path):
    if not out_path.exists():
        return {}
    try:
        entries = json.loads(out_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return {e["url"]: e for e in entries if e.get("url")}


def merge_entries(existing_by_url, fresh_entries, now_iso):
    for entry in fresh_entries:
        url = entry["url"]
        if not url:
            continue
        prev = existing_by_url.get(url)
        merged = dict(entry)
        merged["firstSeenAt"] = prev.get("firstSeenAt", now_iso) if prev else now_iso
        merged["lastSeenAt"] = now_iso
        existing_by_url[url] = merged
    return existing_by_url


def prune(existing_by_url, now_dt):
    cutoff = now_dt - timedelta(days=RETENTION_DAYS)
    kept = []
    for entry in existing_by_url.values():
        try:
            last_seen = datetime.fromisoformat(entry["lastSeenAt"])
        except (KeyError, ValueError):
            last_seen = now_dt
        if last_seen >= cutoff:
            kept.append(entry)
    kept.sort(key=lambda e: e.get("firstSeenAt", ""), reverse=True)
    return kept[:MAX_ENTRIES_PER_CATEGORY]


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    now_jst = datetime.now(timezone.utc).astimezone(JST)
    now_iso = now_jst.isoformat()

    failures = []
    for i, category in enumerate(CATEGORIES):
        if i > 0:
            time.sleep(1)

        out_path = DATA_DIR / f"hotentry-{category}.json"
        try:
            xml_bytes = fetch_rss(category)
            fresh_entries = parse_items(xml_bytes)
        except (urllib.error.URLError, ET.ParseError) as e:
            print(f"[warn] {category}: 取得/解析に失敗、既存データを維持します ({e})", file=sys.stderr)
            failures.append(category)
            continue

        existing_by_url = load_existing(out_path)
        for legacy_entry in existing_by_url.values():
            legacy_entry.setdefault("firstSeenAt", now_iso)
            legacy_entry.setdefault("lastSeenAt", now_iso)
        before_count = len(existing_by_url)
        merged = merge_entries(existing_by_url, fresh_entries, now_iso)
        entries = prune(merged, now_jst)
        new_count = len(entries) - before_count

        out_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[ok] {category}: 累計{len(entries)}件(新規+{max(new_count, 0)}) -> {out_path}")

    next_estimate_jst = now_jst + timedelta(minutes=30)
    meta = {"nextEstimate": next_estimate_jst.strftime("%H:%M")}
    (DATA_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if len(failures) == len(CATEGORIES):
        print("[error] 全カテゴリの取得に失敗しました", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
