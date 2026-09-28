from disclosure.financials import _fiscal_label, _series, _splits


def eps(start, end, val, filed, form="10-K"):
    return {"start": start, "end": end, "val": val, "filed": filed, "form": form, "fp": "FY"}


def test_a_single_split_is_found_and_applied():
    rows = [
        eps("2019-01-01", "2019-12-31", 8.0, "2020-02-01"),
        eps("2020-01-01", "2020-12-31", 10.0, "2021-02-01"),
        # After a 4-for-1 split the next 10-K restates 2020 on the new basis.
        eps("2020-01-01", "2020-12-31", 2.5, "2022-02-01"),
        eps("2021-01-01", "2021-12-31", 3.0, "2022-02-01"),
    ]
    assert _splits(rows, "per_share") == [("2022-02-01", 4)]
    facts = {"us-gaap": {"EarningsPerShareDiluted": {"units": {"USD/shares": rows}}}}
    annual, _ = _series(facts, "EarningsPerShareDiluted", "per_share")
    assert annual["2019-12-31"][0] == 2.0  # 8.00 before the split is 2.00 today
    assert annual["2020-12-31"][0] == 2.5


def test_a_ratio_spanning_two_splits_is_not_a_third_split():
    # Tesla: 5-for-1 in 2020 and 3-for-1 in 2022. A period reported before the first and after
    # the second shows a ratio of 15, which both splits already explain.
    rows = [
        eps("2019-01-01", "2019-12-31", -4.92, "2020-02-13"),
        eps("2019-01-01", "2019-12-31", -0.98, "2021-02-08"),
        eps("2020-01-01", "2020-12-31", 0.64, "2021-02-08"),
        eps("2020-01-01", "2020-12-31", 0.21, "2023-01-31"),
        eps("2019-07-01", "2019-09-30", 0.78, "2019-10-29", "10-Q"),
        eps("2019-07-01", "2019-09-30", 0.052, "2022-10-24", "10-Q"),
    ]
    found = dict(_splits(rows, "per_share"))
    assert sorted(found.values()) == [3, 5]


def test_fiscal_labels():
    assert _fiscal_label("2026-06-30", "0630", False) == "FY2026"
    assert _fiscal_label("2026-03-31", "0630", True) == "Q3 FY26"
    assert _fiscal_label("2026-04-26", "0125", True) == "Q1 FY27"  # NVIDIA's year ends in late January
