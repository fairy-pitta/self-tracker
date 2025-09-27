#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
DOM セレクタ方式で、important.txt に載っている数値をページから見つけて
その要素の安定的な CSS セレクタを学習・保存し、次回以降はセレクタから直接値を取得します。

使い方:
  学習 + 適用:
    python selector_map_numbers.py --url <URL> --important important.txt \
      --template selectors_template.json \
      --out mapped_labels.json --learn --apply

  適用のみ:
    python selector_map_numbers.py --url <URL> \
      --template selectors_template.json \
      --out mapped_labels.json --apply
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from playwright.sync_api import sync_playwright
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs


NumberRe = re.compile(r"[-+]?\d+(?:\.\d+)?")


@dataclass
class LabelValue:
    label: str
    value_str: str
    value_float: Optional[float]
    unit: Optional[str]


def parse_important(imp_path: Path) -> List[LabelValue]:
    """important.txt から (label, value_str, value_float, unit) を抽出"""
    lines = imp_path.read_text(encoding="utf-8").splitlines()
    results: List[LabelValue] = []

    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        # 最初に名前や性別など非数値行をスキップ
        if s.lower().startswith("name:") or s.lower().startswith("gender:"):
            continue
        if s.lower().startswith("time/date"):
            continue

        # ラベルと値部に分ける（コロンあり/なし両対応）
        m = re.match(r"^\s*([A-Za-z /]+)\s*:?\s*(.+)$", s)
        if not m:
            continue
        label = m.group(1).strip()
        rest = m.group(2).strip()

        # 値中の最初の数値を拾う
        mnum = NumberRe.search(rest)
        if not mnum:
            continue
        value_str = mnum.group(0)
        try:
            value_float = float(value_str)
        except Exception:
            value_float = None

        # 単位候補（英字記号）を末尾から抽出（例: 171.0cm -> cm）
        unit_m = re.search(r"[a-zA-Z%]+$", rest)
        unit = unit_m.group(0) if unit_m else None

        results.append(
            LabelValue(
                label=label,
                value_str=value_str,
                value_float=value_float,
                unit=unit,
            )
        )

    return results


SELECTOR_JS = r"""
(() => {
  const numStr = __NUM_STR__;
  const labelStr = __LABEL_STR__;
  const unitStr = __UNIT_STR__;

  // 小さい要素を優先するための area 正規化
  function areaScore(rect) {
    const area = Math.max(1, rect.width * rect.height);
    // 小さいほど高スコアに寄与
    return 1000.0 / Math.max(1, Math.sqrt(area));
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' ||
        style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  function textOf(el) {
    // プレーンテキストを優先
    return (el.innerText || el.textContent || '').trim();
  }

  function containsNumberLike(text, n, unit) {
    if (!text) return false;
    const t = text.trim();
    if (t === n) return 'exact';
    // 単位付き完全一致
    if (unit &&
        (t === `${n}${unit}` || t === `${n} ${unit}`)) return 'exact_unit';
    // 部分一致
    if (t.includes(n)) return 'partial';
    return false;
  }

  function hasNeighborLabel(el, label) {
    if (!label) return false;
    const parent = el.parentElement;
    if (!parent) return false;
    const near = parent.innerText || parent.textContent || '';
    return near.toLowerCase().includes(label.toLowerCase());
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    // ユニーク id があればそれを使う
    if (el.id) {
      const sameId = document.querySelectorAll(`#${CSS.escape(el.id)}`);
      if (sameId && sameId.length === 1) return `#${CSS.escape(el.id)}`;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      let part = cur.tagName.toLowerCase();
      // クラスは多すぎると不安定なので、先頭1,2個だけ
      if (cur.classList && cur.classList.length > 0) {
        const cls = Array.from(cur.classList)
          .filter(c => !!c && !/\d/.test(c))
          .slice(0, 2)
          .map(c => `.${CSS.escape(c)}`)
          .join('');
        part += cls;
      }
      // nth-of-type を付与
      const parent = cur.parentElement;
      if (parent) {
        const tag = cur.tagName.toLowerCase();
        const siblings = Array.from(parent.children)
          .filter(x => x.tagName.toLowerCase() === tag);
        const idx = siblings.indexOf(cur) + 1;
        part += `:nth-of-type(${idx})`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
      if (parts.length > 6) break; // 深すぎるのを防ぐ
    }
    return parts.join(' > ');
  }

  const elements = Array.from(
      document.querySelectorAll('body *'))
    .filter(el => el.childElementCount === 0);
  // テキスト葉要素を中心に

  const candidates = [];
  for (const el of elements) {
    if (!isVisible(el)) continue;
    const t = textOf(el);
    const match = containsNumberLike(t, numStr, unitStr);
    if (!match) continue;

    const rect = el.getBoundingClientRect();
    const base = match === 'exact' ? 60 :
                 (match === 'exact_unit' ? 45 : 10);
    let score = base + areaScore(rect);
    if (hasNeighborLabel(el, labelStr)) score += 20;

    const path = cssPath(el);
    candidates.push({
      elText: t,
      path,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      },
      score
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
})()
"""


def learn_selectors(
    url: str,
    labels: List[LabelValue],
) -> Dict[str, Dict[str, str]]:
    """各ラベルの値に一致する要素を探し、CSS セレクタ候補から最もよいものを採択"""
    selectors: Dict[str, Dict[str, str]] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 4000})
        page.goto(url, wait_until="networkidle")

        for lv in labels:
            js = (
                SELECTOR_JS
                .replace("__NUM_STR__", json.dumps(lv.value_str))
                .replace("__LABEL_STR__", json.dumps(lv.label))
                .replace("__UNIT_STR__", json.dumps(lv.unit or ""))
            )

            topk = page.evaluate(js)
            best = topk[0] if topk else None
            if best and best.get("path"):
                selectors[lv.label] = {
                    "selector": best["path"],
                    "type": "text",
                    "expect": lv.value_str,
                }
            else:
                selectors[lv.label] = {
                    "selector": "",
                    "type": "text",
                    "expect": lv.value_str,
                }
        browser.close()
    return selectors


def apply_selectors(
    url: str,
    selectors: Dict[str, Dict[str, str]],
) -> Dict[str, Optional[float]]:
    """保存された CSS セレクタからテキストを取得して数値化"""
    results: Dict[str, Optional[float]] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 4000})
        page.goto(url, wait_until="networkidle")

        for label, meta in selectors.items():
            sel = meta.get("selector") or ""
            val: Optional[float] = None
            try:
                if sel:
                    t = page.eval_on_selector(
                        sel,
                        "el => (el.innerText || el.textContent || '').trim()",
                    )
                else:
                    t = ""
                if t:
                    m = NumberRe.search(t)
                    if m:
                        val = float(m.group(0))
            except Exception:
                val = None
            results[label] = val
        browser.close()
    return results


def _date_from_url(url: str) -> str:
    qs = parse_qs(urlparse(url).query)
    t_vals = qs.get("t")
    if t_vals:
        try:
            ts = int(t_vals[0])
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            return dt.date().isoformat()
        except Exception:
            return "unknown"
    return "unknown"


def _read_records_file(path: Path) -> List[str]:
    if not path.exists():
        return []
    urls: List[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        urls.append(s)
    return urls


def main():
    ap = argparse.ArgumentParser(
        description="Learn/apply CSS selectors to extract numbers by labels",
    )
    ap.add_argument("--url", default=None)
    ap.add_argument("--important", default="important.txt")
    ap.add_argument("--template", default="selectors_template.json")
    ap.add_argument("--out", default="mapped_labels.json")
    ap.add_argument(
        "--learn",
        action="store_true",
        help="Learn selectors from current page and important.txt values",
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Apply existing selectors to extract values",
    )
    ap.add_argument(
        "--records",
        default=None,
        help=(
            "Path to records.txt that lists URLs (one per line). "
            "If set, run in multi-URL mode."
        ),
    )
    args = ap.parse_args()

    url = args.url
    imp_path = Path(args.important)
    tpl_path = Path(args.template)
    out_path = Path(args.out)

    labels = parse_important(imp_path)

    # 複数URLモード: records.txt を読み込む
    if args.records:
        rec_path = Path(args.records)
        urls = _read_records_file(rec_path)
        if not urls:
            print(f"No URLs found in {rec_path}")
            return

        template: Dict[str, Dict[str, str]] = {}
        if args.learn or not tpl_path.exists():
            # 先頭のURLで学習
            template = learn_selectors(urls[0], labels)
            payload = {"url": urls[0], "selectors": template}
            tpl_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"Saved selectors template -> {tpl_path}")
        else:
            try:
                payload = json.loads(tpl_path.read_text(encoding="utf-8"))
                template = payload.get("selectors", {})
            except Exception:
                template = {}

        grouped: Dict[str, List[Dict[str, object]]] = {}
        for u in urls:
            res = apply_selectors(u, template)
            d = _date_from_url(u)
            grouped.setdefault(d, []).append({"url": u, "labels": res})

        out_payload = {"records": grouped}
        out_path.write_text(
            json.dumps(out_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Saved records mapping -> {out_path}")
        return

    # 既存の単一URLモード
    if url is None:
        print("Error: --url is required when --records is not specified")
        return
    template: Dict[str, Dict[str, str]] = {}

    if args.learn or not tpl_path.exists():
        template = learn_selectors(url, labels)
        payload = {"url": url, "selectors": template}
        tpl_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Saved selectors template -> {tpl_path}")
    else:
        try:
            payload = json.loads(tpl_path.read_text(encoding="utf-8"))
            template = payload.get("selectors", {})
        except Exception:
            template = {}

    if args.apply or not out_path.exists():
        results = apply_selectors(url, template)
        out_payload = {"labels": results}
        out_path.write_text(
            json.dumps(out_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Saved mapped labels -> {out_path}")


if __name__ == "__main__":
    main()