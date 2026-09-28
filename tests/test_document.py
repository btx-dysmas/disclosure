from disclosure import document


def blocks(html: str):
    return document.parse(f"<html><body>{html}</body></html>")


def test_currency_and_parenthesis_cells_join_their_numbers():
    b = blocks("""
      <table>
        <tr><td>Revenue</td><td>$</td><td>1,200</td><td></td><td>$</td><td>900</td></tr>
        <tr><td>Net loss</td><td></td><td>(45</td><td>)</td><td></td><td>(30</td><td>)</td></tr>
      </table>""")
    assert len(b) == 1 and b[0].kind == "table"
    assert "$1,200" in b[0].text and "(45)" in b[0].text
    # Spacer columns are dropped: each row keeps a label and two values.
    assert b[0].html.count("<td") == 6


def test_inline_xbrl_and_hidden_header_are_removed():
    b = blocks("""
      <div style="display:none"><ix:header>hidden facts</ix:header></div>
      <p>Revenue was <ix:nonFraction name="us-gaap:Revenues">331,839</ix:nonFraction> million.</p>""")
    assert [x.text for x in b] == ["Revenue was 331,839 million."]


def test_bullet_characters_join_the_following_paragraph():
    b = blocks("<p>•</p><p>Microsoft Cloud revenue increased 27%.</p>")
    assert len(b) == 1 and b[0].text == "Microsoft Cloud revenue increased 27%."
    assert "bullet" in b[0].html


def test_running_page_headers_are_dropped():
    page = "<p>PART II</p><p>Item 7</p><p>Body text that differs on page {n}.</p>"
    b = blocks("".join(page.format(n=n) for n in range(6)))
    assert all(x.text not in ("PART II", "Item 7") for x in b)


def test_sections_skip_the_table_of_contents():
    toc = "".join(f"<p><b>Item {k}. {t}</b></p>" for k, t in (("1", "Business"), ("1A", "Risk Factors"), ("7", "Management's Discussion")))
    body = (
        "<p><b>Item 1. Business</b></p>" + "<p>We make software.</p>" * 20 +
        "<p><b>Item 1A. Risk Factors</b></p>" + "<p>Competition is intense.</p>" * 20 +
        "<p><b>Item 7. Management's Discussion</b></p>" + "<p>Revenue increased.</p>" * 20
    )
    b = blocks(toc + body)
    secs, _ = document.sections(b, "10-K")
    assert [s["key"] for s in secs] == ["1", "1A", "7"]
    # Each section starts at its body heading, not at the table of contents entry.
    assert all(s["block"] >= 3 for s in secs)
    assert secs[1]["title"] == "Risk factors"


def test_ten_q_items_are_keyed_by_part():
    html = (
        "<p><b>PART I</b></p><p><b>Item 1. Financial Statements</b></p>" + "<p>Balance sheet.</p>" * 10 +
        "<p><b>Item 2. Management's Discussion</b></p>" + "<p>Results.</p>" * 10 +
        "<p><b>PART II</b></p><p><b>Item 1. Legal Proceedings</b></p>" + "<p>None.</p>" * 10 +
        "<p><b>Item 1A. Risk Factors</b></p>" + "<p>No material changes.</p>" * 10
    )
    secs, _ = document.sections(blocks(html), "10-Q")
    assert [s["key"] for s in secs] == ["I-1", "I-2", "II-1", "II-1A"]
