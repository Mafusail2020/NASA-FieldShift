import pytest

from core.crops import COLUMNS, load_crops, todo_cells


def test_real_file_loads():
    df = load_crops()
    assert list(df.columns) == COLUMNS
    assert len(todo_cells(df)) > 0


def write(tmp_path, body):
    p = tmp_path / "c.csv"
    p.write_text("crop,parameter,value,unit,source,status\n" + body)
    return p


def test_empty_value_needs_todo(tmp_path):
    with pytest.raises(ValueError, match="empty value"):
        load_crops(write(tmp_path, "maize,kc_mid,,,x,data\n"))


def test_bad_status(tmp_path):
    with pytest.raises(ValueError, match="invalid status"):
        load_crops(write(tmp_path, "maize,kc_mid,1.2,,x,guess\n"))


def test_value_needs_source(tmp_path):
    with pytest.raises(ValueError, match="without source"):
        load_crops(write(tmp_path, "maize,kc_mid,1.2,,,literature\n"))


def test_missing_column(tmp_path):
    p = tmp_path / "c.csv"
    p.write_text("crop,parameter,value\nmaize,kc_mid,1\n")
    with pytest.raises(ValueError, match="missing columns"):
        load_crops(p)
