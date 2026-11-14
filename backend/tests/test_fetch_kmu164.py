import pytest

from pipeline.fetch_kmu164 import note_text, parse

NOTE = (
    "Примітка. Допустимі нормативи періодичності вирощування культури на одному і тому самому полі становлять: "
    "для озимих жита і ячменю, ячменю ярого, вівса, гречки - не менше ніж через один рік; "
    "для пшениці озимої, картоплі, проса - не менше ніж через два роки; "
    "для кукурудзи в сівозміні або на тимчасово виведеному із сівозміни полі - протягом двох - трьох років поспіль; "
    "для багаторічних бобових трав, зернобобових культур (крім люпину), буряку цукрового і кормового, ріпаку озимого і ярого - "
    "не менше ніж через три роки; для льону - не менше ніж через п'ять років; "
    "для люпину, капусти - не менше ніж через шість років; для соняшника - не менше ніж через сім років; "
    "для лікарських рослин (залежно від біологічних властивостей) - один - десять років. "
    "{ Нормативи із змінами, внесеними згідно з Постановою КМ N 536 }"
)
DEMO = {"winter_wheat", "maize", "sunflower", "pea", "soybean", "winter_rapeseed", "winter_barley", "spring_barley",
        "sugar_beet", "buckwheat", "millet", "oats"}


def test_parse_values():
    df = parse(note_text(f"<html><body><p>{NOTE}</p></body></html>")).set_index("crop")
    assert DEMO <= set(df.index)
    assert df.loc["sunflower", "value_min"] == 7
    assert df.loc["winter_wheat", "value_min"] == 2
    assert df.loc["oats", "value_min"] == 1
    assert df.loc["winter_rapeseed", "value_min"] == df.loc["spring_rapeseed", "value_min"] == 3
    assert df.loc["lupin", "value_min"] == 6  # '(крім люпину)' in the pulses clause must not match lupin there
    assert df.loc["pea", "value_min"] == 3
    assert df.loc["soybean", "status"] == "estimate"
    assert (df.loc["maize", "kind"], df.loc["maize", "value_min"], df.loc["maize", "value_max"]) == ("max_years_in_a_row", 2, 3)


def test_missing_note_raises():
    with pytest.raises(ValueError):
        note_text("<html>no note here</html>")
