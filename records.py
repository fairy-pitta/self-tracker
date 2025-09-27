from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List
from urllib.parse import urlparse, parse_qs

# このモジュールは、FITMAOレポートのURLを「日付ごと」に管理します。
# URL のクエリパラメータ t (UNIX秒) から日付 (YYYY-MM-DD, UTC) を推定し、
# t が無い場合は "unknown" としてグルーピングします。

RecordsType = Dict[str, List[str]]


def _date_from_url(url: str) -> str:
    qs = parse_qs(urlparse(url).query)
    t_vals = qs.get("t")
    if t_vals:
        try:
            ts = int(t_vals[0])
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            return dt.date().isoformat()
        except Exception:
            # 予期しない値の場合は unknown とする
            return "unknown"
    return "unknown"


def _add(record_map: RecordsType, url: str) -> None:
    d = _date_from_url(url)
    record_map.setdefault(d, []).append(url)


# ここに URL を登録していきます（今後URLを追記してOK）
RECORDS: RecordsType = {}

_add(
    RECORDS,
    (
        "https://www.fitmao.com/index.php?"
        "m=renti&a=print&iscan=1&origin=3&dzid=&f=en&"
        "id=1480724"
        "&rpkey=2391025a97cc5f206e3ae349918df2f93da64d86"
        "&t=1758251593"
    ),
)
_add(
    RECORDS,
    (
        "https://www.fitmao.com/index.php?"
        "m=renti&a=print&iscan=1&origin=3&dzid=&f=en&"
        "id=1474622"
        "&rpkey=7cb62675e56528ff71c7a9145d064ed0e3795754"
        "&t=1757993136"
    ),
)
_add(
    RECORDS,
    (
        "https://www.fitmao.com/index.php?"
        "m=renti&a=print&iscan=1&origin=3&dzid=&f=en&"
        "id=1469636"
        "&rpkey=ee82e5014e9f518e5eda37ad4a8a4d083620c3eb"
        "&t=1757765058"
    ),
)
_add(
    RECORDS,
    (
        "https://www.fitmao.com/index.php?"
        "m=renti&a=print&iscan=1&origin=3&"
        "id=1488031&ishis=0"
        "&rpkey=8ee55553b10ef4e3a94df66fe5783a3040a196d5"
        "&f=en"
    ),
)


def get_records() -> RecordsType:
    """URLを日付別にまとめた辞書を返します。
    例: {"2025-09-16": [url1, url2], "unknown": [url3]} のような形式。
    """
    return RECORDS