from disclosure.segments import _label, _structure


def test_complete_breakdowns_on_one_axis_are_split():
    # Amazon tags store types and also product/service sales, each adding up to total revenue.
    latest = {"a:Online": 269.3, "a:ThirdParty": 172.2, "a:AWS": 128.7, "a:Ads": 68.6, "a:Subs": 49.6, "a:Physical": 22.6, "a:Other": 5.9,
              "a:Service": 420.7, "a:Product": 296.3}
    groups, parent = _structure(sorted(latest, key=lambda m: -latest[m]), latest, 717.0)
    assert len(groups) == 2 and not parent
    assert set(groups[1]) == {"a:Service", "a:Product"}


def test_subtotals_nest_their_components():
    # Apple tags Products and also the product lines that make it up.
    latest = {"a:Products": 307.0, "a:iPhone": 209.6, "a:Services": 109.2, "a:Wearables": 35.7, "a:Mac": 33.7, "a:iPad": 28.0}
    prior = {"a:Products": 294.9, "a:iPhone": 201.2, "a:Services": 96.2, "a:Wearables": 37.0, "a:Mac": 30.0, "a:iPad": 26.7}
    groups, parent = _structure(sorted(latest, key=lambda m: -latest[m]), latest, 416.2, prior)
    assert len(groups) == 1
    assert {c for c, p in parent.items() if p == "a:Products"} == {"a:iPhone", "a:Wearables", "a:Mac", "a:iPad"}


def test_a_coincidental_sum_is_not_a_subtotal():
    # Compute + Networking make up Data Center; a small OEM line fits within rounding one year only.
    latest = {"n:DataCenter": 193.7, "n:Compute": 162.4, "n:Networking": 31.4, "n:Gaming": 16.0, "n:ProViz": 3.2, "n:Auto": 2.3, "n:OEM": 0.6}
    prior = {"n:DataCenter": 115.2, "n:Compute": 102.2, "n:Networking": 13.0, "n:Gaming": 11.3, "n:ProViz": 1.9, "n:Auto": 1.7, "n:OEM": 0.4}
    _, parent = _structure(sorted(latest, key=lambda m: -latest[m]), latest, 215.9, prior)
    assert parent.get("n:OEM") is None
    assert parent["n:Compute"] == parent["n:Networking"] == "n:DataCenter"


def test_labels_come_from_metalinks_with_suffixes_removed():
    labels = {"msft_IntelligentCloudMember": {"lang": {"en-us": {"role": {"label": "Intelligent Cloud [Member]"}}}}}
    assert _label("msft:IntelligentCloudMember", labels) == "Intelligent Cloud"
    assert _label("country:US", {}) == "United States"
    assert _label("abc:NorthAmericaSegmentMember", {}) == "North America"
