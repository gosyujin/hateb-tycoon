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

import article_body

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

# 記事本文でdescriptionを差し替える処理(article_body.py)の上限。相手のサイトに迷惑をかけず、
# かつデータ更新(RSSの取得とコミット)を遅らせないため、1回の実行で取りに行く件数と時間を絞る。
# 溜まっている分は新しい記事から順に、実行のたびに少しずつ消化する。
MAX_BODY_FETCH_PER_RUN = 40
BODY_TIME_BUDGET_SEC = 240
BODY_MAX_TRIES = 3  # 通信の都合(retry)で失敗した記事を、あと何回まで再挑戦するか


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
        if prev:
            # 本文で差し替え済みのdescriptionと、取得の記録は、RSSの新しい値で上書きしない
            for key in ("descriptionSource", "bodyStatus", "bodyReason", "bodyTries"):
                if key in prev:
                    merged[key] = prev[key]
            if prev.get("descriptionSource") == "body":
                merged["description"] = prev.get("description")
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


def needs_body(entry):
    return (
        bool(entry.get("url"))
        and not article_body.is_excluded_url(entry["url"])
        and entry.get("descriptionSource") != "body"
        # 理由を記録する前にskipにした記事は、理由を残すために1回だけ取り直す
        and (entry.get("bodyStatus") != "skip" or "bodyReason" not in entry)
        and entry.get("bodyTries", 0) < BODY_MAX_TRIES
    )


def apply_body_result(entry, status, text, reason=""):
    """取得結果を記事に反映する。descriptionより長くなる時だけ差し替える(情報量が増えない時は元のまま)。

    取れなかった理由は bodyReason に短いコード(例: http-403, robots-disallow)で残す。
    画面が「記事が取得できませんでした(理由)」を出すのに使う(js/app.jsのBODY_REASON_LABEL)。
    """
    code = (reason or "").split(":")[0].strip()
    if status == article_body.OK and text and len(text) > len(entry.get("description") or ""):
        entry["description"] = text
        entry["descriptionSource"] = "body"
        entry.pop("bodyTries", None)
        entry.pop("bodyReason", None)
    elif status == article_body.OK:
        entry["bodyStatus"] = "skip"
        entry["bodyReason"] = "not-longer"
        entry.pop("bodyTries", None)
    elif status == article_body.RETRY:
        entry["bodyTries"] = entry.get("bodyTries", 0) + 1
        entry["bodyReason"] = code or "unknown"
    else:
        entry["bodyStatus"] = "skip"
        entry["bodyReason"] = code or "unknown"
        entry.pop("bodyTries", None)


def enrich_with_bodies(entries_by_category, fetcher=None, now=time.monotonic):
    """記事本文の抜粋でdescriptionを差し替える。同じURLは複数カテゴリーにあっても1回だけ取りに行く。"""
    targets = {}
    for entries in entries_by_category.values():
        for entry in entries:
            if entry.get("url") and article_body.is_excluded_url(entry["url"]):
                entry["bodyStatus"] = "skip"
                entry["bodyReason"] = "hatena-bookmark-page"
            if needs_body(entry):
                targets.setdefault(entry["url"], (entry.get("firstSeenAt", ""), entry.get("title", "")))
    pending = sorted(targets, key=lambda u: targets[u][0], reverse=True)  # 新しい記事から
    if not pending:
        return

    fetcher = fetcher or article_body.BodyFetcher()
    deadline = now() + BODY_TIME_BUDGET_SEC
    results = {}
    for url in pending[:MAX_BODY_FETCH_PER_RUN]:
        if now() > deadline:
            print(f"[warn] 本文の取得は時間切れのため打ち切ります(残り{len(pending) - len(results)}件)", file=sys.stderr)
            break
        status, text, reason = fetcher.fetch(url, targets[url][1])
        results[url] = (status, text, reason)
        print(f"[body] {status:5} {reason:20} {url}")

    for entries in entries_by_category.values():
        for entry in entries:
            if entry.get("url") in results:
                apply_body_result(entry, *results[entry["url"]])
    done = sum(1 for status, _text, _reason in results.values() if status == article_body.OK)
    print(f"[ok] 本文: 取得{len(results)}件(成功{done}件)、未着手{len(pending) - len(results)}件")


def build_everything():
    """「全て」タブ用に、全カテゴリーをurl基準で重複排除してマージしたデータを作る。

    アプリは以前、10ファイルを取得してブラウザ側でマージしていた(js/hatena-api.jsの
    mergeEverythingと同じ規則: 「総合」を土台に、無い記事だけを他カテゴリーから追加)。
    リクエストを1本にして、遅い1本に全体が引きずられるのを避けるため事前に作る。
    """
    merged = []
    seen = set()
    for category in CATEGORIES:
        path = DATA_DIR / f"hotentry-{category}.json"
        try:
            entries = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for entry in entries:
            if entry.get("url") in seen:
                continue
            seen.add(entry.get("url"))
            merged.append(entry)
    return merged


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    now_jst = datetime.now(timezone.utc).astimezone(JST)
    now_iso = now_jst.isoformat()

    failures = []
    entries_by_category = {}
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
            # 本文を取りに行かない対象(はてなブックマークのページ=二階建て)に、以前の実行で
            # 差し替えてしまった内容が残っていれば取り消す(次のRSSで概要が戻る。無ければ空)
            if legacy_entry.get("descriptionSource") == "body" and article_body.is_excluded_url(legacy_entry.get("url", "")):
                legacy_entry["description"] = None
                legacy_entry.pop("descriptionSource", None)
        before_count = len(existing_by_url)
        merged = merge_entries(existing_by_url, fresh_entries, now_iso)
        entries = prune(merged, now_jst)
        new_count = len(entries) - before_count

        entries_by_category[category] = entries
        print(f"[ok] {category}: 累計{len(entries)}件(新規+{max(new_count, 0)})")

    # 本文の取得は、全カテゴリーの合併後に1回だけ行う(同じ記事を何度も取りに行かない)。
    # 失敗しても、RSSのdescriptionのままデータ更新は続ける。
    try:
        enrich_with_bodies(entries_by_category)
    except Exception as e:  # 本文取得の不具合で、肝心のデータ更新まで止めない
        print(f"[warn] 本文の取得で想定外のエラー、RSSのdescriptionのまま続けます ({e!r})", file=sys.stderr)

    for category, entries in entries_by_category.items():
        out_path = DATA_DIR / f"hotentry-{category}.json"
        out_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if len(failures) < len(CATEGORIES):
        everything = build_everything()
        (DATA_DIR / "hotentry-everything.json").write_text(
            json.dumps(everything, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"[ok] everything: {len(everything)}件")

    # cronは30分間隔だが、実際はローカルから15分おきにworkflow_dispatchしている
    # (docs/decisions/cron-local-dispatch.md)ため、実態に合わせて15分後を目安にする。
    # フッターの「次回更新」とストリーム表示の自動間隔がこの値を使う。
    next_estimate_jst = now_jst + timedelta(minutes=15)
    meta = {"nextEstimate": next_estimate_jst.strftime("%H:%M")}
    (DATA_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if len(failures) == len(CATEGORIES):
        print("[error] 全カテゴリの取得に失敗しました", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
