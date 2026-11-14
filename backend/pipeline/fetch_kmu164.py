"""Minimum return intervals of crops on the same field, from KMU Resolution No. 164 of 11.02.2010.

Source: the 'Prymitka' (note) under the table of norms, official text on zakon.rada.gov.ua (print view, plain HTML;
the normal page needs JavaScript). The script keeps the source sentence for every row.
Output: data/raw/crops/kmu164_return_years.csv. It does not touch data/params/: Ivan decides what is promoted.
Run by hand from backend/: python -m pipeline.fetch_kmu164 [--refresh]
"""
import html
import re
import sys
from pathlib import Path

import pandas as pd
import requests

OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "crops"
CACHE = OUT_DIR / "_cache" / "kmu164_print.html"
URL = "https://zakon.rada.gov.ua/laws/show/164-2010-%D0%BF/print"
SOURCE = ("Resolution of the Cabinet of Ministers of Ukraine No. 164 of 11.02.2010 (as amended by No. 536 of 30.06.2010), "
          "note under the table of norms; " + URL.removesuffix("/print"))

NUMBERS = {"один": 1, "одного": 1, "два": 2, "двох": 2, "три": 3, "трьох": 3, "п'ять": 5, "шість": 6, "сім": 7}

# Phrase in the source list -> crop ids. Matched on the clause with '(крім ...)' removed. Our 12 demo crops have plain
# names; the rest are other crops named by the resolution (kept so the table is complete).
PHRASES = [
    ("озимих жита і ячменю", ["winter_rye", "winter_barley"]),
    ("ячменю ярого", ["spring_barley"]),
    ("вівса", ["oats"]),
    ("гречки", ["buckwheat"]),
    ("пшениці озимої", ["winter_wheat"]),
    ("картоплі", ["potato"]),
    ("проса", ["millet"]),
    ("кукурудзи", ["maize"]),
    ("багаторічних бобових трав", ["perennial_legumes"]),
    ("зернобобових культур", ["pea", "soybean"]),
    ("буряку цукрового", ["sugar_beet"]),
    ("кормового", ["fodder_beet"]),
    ("ріпаку озимого і ярого", ["winter_rapeseed", "spring_rapeseed"]),
    ("льону", ["flax"]),
    ("люпину", ["lupin"]),
    ("капусти", ["cabbage"]),
    ("соняшника", ["sunflower"]),
]
NOTES = {
    "soybean": "Resolution says 'zernobobovi kultury' (pulses, except lupin); that soybean belongs to this group is my reading",
    "winter_barley": "Resolution names 'ozymi zhyto i yachmin' (winter rye and barley)",
}


def fetch(refresh: bool = False) -> str:
    if CACHE.exists() and not refresh:
        return CACHE.read_text(encoding="utf-8")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    CACHE.write_text(r.text, encoding="utf-8")
    return r.text


def note_text(page: str) -> str:
    """Plain text of the note sentence, from 'Допустимі нормативи' up to the amendment mark."""
    body = re.sub(r"<(script|style).*?</\1>", "", page, flags=re.S)
    body = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body)))
    m = re.search(r"Допустимі нормативи періодичності.*?(?=\{ Нормативи із змінами)", body)
    if not m:
        raise ValueError("note with return intervals not found; the page layout may have changed")
    return m.group(0).strip()


def parse(note: str) -> pd.DataFrame:
    """One row per crop: min_return_years, or (for maize) max_years_in_a_row."""
    body = note.split("становлять:", 1)[1]
    rows = []
    for clause in (c.strip(" .") for c in body.split(";")):
        m = re.match(r"для (.+?) - (.+)$", clause)
        if not m:
            continue
        crops_txt, rule = m.groups()
        if "лікарських" in crops_txt:
            continue  # 'medicinal plants (by biology) 1-10 years': not a single value
        crops_txt = re.sub(r"\(крім [^)]*\)", "", crops_txt)
        if "поспіль" in rule:  # maize: allowed to follow itself 2-3 years in a row
            nums = [NUMBERS[w] for w in re.findall(r"двох|трьох", rule)]
            kind, lo, hi = "max_years_in_a_row", min(nums), max(nums)
        else:
            word = re.search(r"через (\S+)", rule).group(1)
            kind, lo, hi = "min_return_years", NUMBERS[word], NUMBERS[word]
        for phrase, ids in PHRASES:
            if phrase in crops_txt:
                for cid in ids:
                    rows.append({"crop": cid, "kind": kind, "value_min": lo, "value_max": hi, "unit": "years",
                                 "source": SOURCE + f"; clause: '{clause}'" + (f"; {NOTES[cid]}" if cid in NOTES else ""),
                                 "status": "estimate" if cid == "soybean" else "literature"})
    df = pd.DataFrame(rows)
    if df.crop.duplicated().any():
        raise ValueError(f"crop matched in two clauses: {df.crop[df.crop.duplicated()].tolist()}")
    return df


def main() -> None:
    df = parse(note_text(fetch("--refresh" in sys.argv)))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_DIR / "kmu164_return_years.csv", index=False)
    print(df[["crop", "kind", "value_min", "value_max", "status"]].to_string(index=False))
    print(f"\n{len(df)} rows -> data/raw/crops/kmu164_return_years.csv")


if __name__ == "__main__":
    main()
