"""
記事の本文(の抜粋)を取得する。fetch_hotentry.py が、RSS由来のdescriptionの代わりに使う。
Python標準ライブラリのみで動作する(追加パッケージ不要)。経緯・判断は
docs/decisions/article-body-description.md を参照。

他人のサイトにリクエストを送るため、迷惑をかけないことを最優先にしている。
- robots.txt を守る(取得前に毎回確認。401/403は全面禁止、404などは許可、5xx・通信失敗は今回は見送る)。
  リダイレクトは自動で追わず、1ホップごとに転送先のrobots.txtを確認する。
- ボットであることを名乗るUser-Agentを使う(連絡先のURL付き)。
- 同じホストへは間隔を空ける(HOST_MIN_INTERVAL_SEC。robots.txtのCrawl-delayがあればそれ以上)。
- 全体を直列で行い、並列にしない。429/503を返したホストは、その実行中はもう叩かない。
- HTML以外・大きすぎる応答は読み込まない。<meta name="robots" content="nosnippet">は尊重して使わない。
- 取得するのは抜粋(MAX_BODY_CHARS文字)だけで、全文は保存しない。
"""
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

# fetch_hotentry.py と同じUser-Agent。robots.txtの照合にはROBOTS_TOKEN(最初の語)を使う。
USER_AGENT = "hateb-tycoon-bot/1.0 (+https://github.com/gosyujin/hateb-tycoon)"
ROBOTS_TOKEN = "hateb-tycoon-bot"

MAX_BODY_CHARS = 300  # 抜粋の長さ。RSSのdescription(平均150字ほど)の約2倍
MIN_USEFUL_CHARS = 100  # 本文として拾えた文字数がこれ未満なら、<meta>のdescriptionのほうを優先して見る
MIN_BLOCK_CHARS = 40  # これより短い塊(メニュー・見出し・日付など)は本文とみなさない
FETCH_TIMEOUT_SEC = 10
MAX_HTML_BYTES = 600_000
MAX_REDIRECTS = 3
HOST_MIN_INTERVAL_SEC = 3.0
MAX_CRAWL_DELAY_SEC = 30.0  # これより長いCrawl-delayを指定するホストは、今回は見送る(取得に時間がかかりすぎる)

# 戻り値のstatus。skipは「このURLはもう試さない」、retryは「通信の都合なので次回以降に再挑戦」。
OK = "ok"
SKIP = "skip"
RETRY = "retry"

SKIP_EXTENSIONS = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".zip", ".gz", ".mp3", ".mp4", ".mov",
    ".csv", ".xlsx", ".pptx", ".docx",
)

# 本文ではない領域のタグ
EXCLUDED_TAGS = {
    "head", "script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside",
    "form", "button", "select", "iframe", "figcaption", "dialog",
}
# これらの開始・終了で文字の塊を区切る
BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article",
    "main", "blockquote", "tr", "td", "th", "table", "hr", "pre", "dd", "dt", "dl",
}
# 短い塊に混じりやすい定型文(これを含む短い塊は捨てる)
BOILERPLATE = re.compile(
    r"(copyright|all rights reserved|cookie|javascript|ログイン|会員登録|無料登録|購読|"
    r"プライバシー|利用規約|免責|広告|スポンサー|シェア|ツイート|フォロー|続きを読む|"
    r"この記事を|関連記事|おすすめ|ランキング|©)",
    re.IGNORECASE,
)
BOILERPLATE_MAX_CHARS = 120


def normalize_space(text):
    return re.sub(r"\s+", " ", text).strip()


class _BodyParser(HTMLParser):
    """文字の塊(ブロック)に分けながら、本文候補と<meta>の情報を集める。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.excluded_depth = 0
        self.main_depth = 0  # <article>/<main>の中にいる深さ
        self.buf = []
        self.main_blocks = []  # <article>/<main>の中の塊
        self.all_blocks = []  # ページ全体の塊
        self.meta = {}  # name/property(小文字) -> content

    def _flush(self):
        text = normalize_space("".join(self.buf))
        self.buf = []
        if not text:
            return
        self.all_blocks.append(text)
        if self.main_depth > 0:
            self.main_blocks.append(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            content = a.get("content")
            if key and content and key not in self.meta:
                self.meta[key] = content
            return
        if tag == "body":
            # <head>の閉じ忘れで、本文まで除外してしまわないようにする
            self.excluded_depth = 0
        if tag in BLOCK_TAGS:
            self._flush()
        if tag in EXCLUDED_TAGS:
            self.excluded_depth += 1
        if tag in ("article", "main") or a.get("role") == "main":
            self.main_depth += 1

    def handle_endtag(self, tag):
        if tag in BLOCK_TAGS:
            self._flush()
        if tag in EXCLUDED_TAGS and self.excluded_depth > 0:
            self.excluded_depth -= 1
        if tag in ("article", "main") and self.main_depth > 0:
            self.main_depth -= 1

    def handle_data(self, data):
        if self.excluded_depth == 0:
            self.buf.append(data)

    def close(self):
        super().close()
        self._flush()


def _usable_blocks(blocks):
    out = []
    for b in blocks:
        if len(b) < MIN_BLOCK_CHARS:
            continue
        if len(b) <= BOILERPLATE_MAX_CHARS and BOILERPLATE.search(b):
            continue
        out.append(b)
    return out


def _clip(text, limit=MAX_BODY_CHARS):
    text = normalize_space(text)
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _title_candidates(title):
    """記事タイトルと、サイト名の付いた後ろ(「 - サイト名」「｜サイト名」)を落としたもの。"""
    cands = {normalize_space(title or "")}
    for sep in (" - ", " | ", "｜", " – ", " — ", " ｜ "):
        for c in list(cands):
            if sep in c:
                cands.add(c.split(sep)[0].strip())
    return sorted((c for c in cands if len(c) >= 8), key=len, reverse=True)


def _strip_leading_title(text, title):
    """本文の頭に見出しとして重なっているタイトル(同じものが続く場合も)を取り除く。"""
    cands = _title_candidates(title)
    changed = True
    while changed and text:
        changed = False
        for c in cands:
            if text.startswith(c):
                text = text[len(c):].lstrip(" 　-|｜:：")
                changed = True
    return text


def extract_excerpt(html_text, title=""):
    """HTMLから抜粋を取り出す。取れなければNone。nosnippet指定のページは (None, 'nosnippet')。

    titleを渡すと、本文の頭に重なっているタイトルを取り除く(抜粋の字数をタイトルで無駄にしないため)。
    戻り値は (抜粋 or None, 理由)。理由は取れなかった時の説明(ログ用)。
    """
    parser = _BodyParser()
    try:
        parser.feed(html_text)
        parser.close()
    except Exception:  # 壊れたHTMLでパーサが落ちても、このURLを諦めるだけにする
        return None, "parse-error"

    robots_meta = (parser.meta.get("robots") or "").lower()
    if "nosnippet" in robots_meta or "max-snippet:0" in robots_meta.replace(" ", ""):
        return None, "nosnippet"

    main = _usable_blocks(parser.main_blocks)
    blocks = main if sum(len(b) for b in main) >= MIN_USEFUL_CHARS else _usable_blocks(parser.all_blocks)
    body = _clip(_strip_leading_title(" ".join(blocks), title)) if blocks else ""

    meta_desc = normalize_space(parser.meta.get("og:description") or parser.meta.get("description") or "")
    if len(body) >= MIN_USEFUL_CHARS:
        return body, "body"
    if meta_desc:
        return _clip(meta_desc), "meta"
    if body:
        return body, "short-body"
    return None, "no-text"


def _decode(data, content_type):
    charset = None
    m = re.search(r"charset=([\w\-]+)", content_type or "", re.IGNORECASE)
    if m:
        charset = m.group(1)
    if not charset:
        head = data[:4096].decode("ascii", errors="ignore")
        m = re.search(r"<meta[^>]+charset=[\"']?([\w\-]+)", head, re.IGNORECASE)
        charset = m.group(1) if m else "utf-8"
    try:
        return data.decode(charset, errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """リダイレクトを自動で追わせない(転送先ごとにrobots.txtを確認するため、自前で辿る)。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BodyFetcher:
    def __init__(self, user_agent=USER_AGENT, sleep=time.sleep, clock=time.monotonic):
        self.user_agent = user_agent
        self._sleep = sleep
        self._clock = clock
        self._opener = urllib.request.build_opener(_NoRedirect)
        self._robots = {}  # origin -> RobotFileParser | "allow-all" | "disallow-all" | "retry"
        self._last_request = {}  # host -> 最後にリクエストした時刻
        self._blocked_hosts = set()  # 429/503を返したホスト(この実行中は叩かない)

    # ---- 通信 ----
    def _wait_turn(self, host, interval):
        last = self._last_request.get(host)
        if last is not None:
            remaining = interval - (self._clock() - last)
            if remaining > 0:
                self._sleep(remaining)
        self._last_request[host] = self._clock()

    def _request(self, url, accept):
        """1回だけリクエストする。戻り値は (status, headers, body)。リダイレクトも(status, ...)で返す。"""
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": accept, "Accept-Language": "ja,en;q=0.5"})
        try:
            with self._opener.open(req, timeout=FETCH_TIMEOUT_SEC) as res:
                return res.status, res.headers, res.read(MAX_HTML_BYTES)
        except urllib.error.HTTPError as e:
            try:
                body = e.read(MAX_HTML_BYTES) if e.code < 300 or e.code >= 400 else b""
            except Exception:
                body = b""
            return e.code, e.headers, body

    # ---- robots.txt ----
    def _robots_for(self, origin, host):
        cached = self._robots.get(origin)
        if cached is not None:
            return cached
        self._wait_turn(host, HOST_MIN_INTERVAL_SEC)
        try:
            status, _headers, body = self._request(origin + "/robots.txt", "text/plain,*/*;q=0.1")
        except (urllib.error.URLError, OSError, ValueError):
            return "retry"  # 通信失敗はキャッシュしない(次回以降に再挑戦)
        if status in (401, 403):
            rules = "disallow-all"
        elif 300 <= status < 400:
            rules = "allow-all"  # robots.txtのリダイレクトは追わず、無いものとして扱う(許可)
        elif 400 <= status < 500:
            rules = "allow-all"
        elif status >= 500:
            return "retry"
        else:
            rp = urllib.robotparser.RobotFileParser()
            rp.parse(body.decode("utf-8", errors="replace").splitlines())
            rules = rp
        self._robots[origin] = rules
        return rules

    def _check_robots(self, url):
        """取得してよいか。戻り値は (status or None, 理由)。Noneなら許可。"""
        parts = urllib.parse.urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        rules = self._robots_for(origin, parts.netloc)
        if rules == "retry":
            return RETRY, "robots-unavailable"
        if rules == "allow-all":
            return None, ""
        if rules == "disallow-all":
            return SKIP, "robots-disallow"
        if not rules.can_fetch(ROBOTS_TOKEN, url):
            return SKIP, "robots-disallow"
        delay = rules.crawl_delay(ROBOTS_TOKEN)
        if delay is not None and delay > MAX_CRAWL_DELAY_SEC:
            return RETRY, "crawl-delay-too-long"
        return None, ""

    # ---- 本体 ----
    def fetch(self, url, title=""):
        """記事の抜粋を取得する。戻り値は (status, text or None, 理由)。titleは本文の頭の重複除去に使う。"""
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            return SKIP, None, "bad-url"
        if parts.path.lower().endswith(SKIP_EXTENSIONS):
            return SKIP, None, "not-html"

        current = url
        for _ in range(MAX_REDIRECTS + 1):
            parts = urllib.parse.urlsplit(current)
            host = parts.netloc
            if host in self._blocked_hosts:
                return RETRY, None, "host-blocked"

            verdict, reason = self._check_robots(current)
            if verdict is not None:
                return verdict, None, reason

            rules = self._robots.get(f"{parts.scheme}://{host}")
            interval = HOST_MIN_INTERVAL_SEC
            if isinstance(rules, urllib.robotparser.RobotFileParser):
                delay = rules.crawl_delay(ROBOTS_TOKEN)
                if delay is not None:
                    interval = max(interval, float(delay))
            self._wait_turn(host, interval)

            try:
                status, headers, body = self._request(current, "text/html,application/xhtml+xml;q=0.9")
            except (urllib.error.URLError, OSError, ValueError) as e:
                return RETRY, None, f"network: {e}"

            if status in (301, 302, 303, 307, 308):
                location = headers.get("Location")
                if not location:
                    return SKIP, None, "redirect-without-location"
                current = urllib.parse.urljoin(current, location)
                continue
            if status in (429, 503):
                self._blocked_hosts.add(host)
                return RETRY, None, f"http-{status}"
            if status >= 500:
                return RETRY, None, f"http-{status}"
            if status != 200:
                return SKIP, None, f"http-{status}"

            content_type = headers.get("Content-Type", "")
            if "html" not in content_type.lower():
                return SKIP, None, "not-html"
            if "noindex" in (headers.get("X-Robots-Tag") or "").lower() or "nosnippet" in (headers.get("X-Robots-Tag") or "").lower():
                return SKIP, None, "x-robots-tag"

            text, why = extract_excerpt(_decode(body, content_type), title)
            if text is None:
                return SKIP, None, why
            return OK, text, why
        return SKIP, None, "too-many-redirects"
