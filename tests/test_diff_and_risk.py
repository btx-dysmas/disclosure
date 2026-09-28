from disclosure import diff, document
from disclosure.risk import split


def test_word_diff_marks_insertions_and_deletions():
    html = diff.words("LinkedIn revenue increased 9%.", "LinkedIn revenue increased 11%.")
    assert "<del>9</del>" in html and "<ins>11</ins>" in html


def test_paragraphs_are_aligned_by_content():
    old = ["Intro paragraph that stays the same across both years of filings.",
           "Revenue increased 15% driven by cloud services growth across all of our commercial segments and regions worldwide.",
           "A paragraph that was dropped entirely from the new filing text."]
    new = ["Intro paragraph that stays the same across both years of filings.",
           "Revenue increased 18% driven by cloud services growth across all of our commercial segments and regions worldwide.",
           "A brand new paragraph about artificial intelligence infrastructure."]
    ops = [r["op"] for r in diff.paragraphs(old, new)]
    assert ops.count("equal") == 1 and ops.count("changed") == 1 and ops.count("added") == 1 and ops.count("removed") == 1


def test_short_sentences_need_a_close_match():
    rows = diff.paragraphs(["Xbox content and services revenue increased 16%."], ["Azure and other cloud services revenue increased 41%."])
    assert {r["op"] for r in rows} == {"added", "removed"}


def B(text, bold=False, italic=False, html=None):
    return document.Block("p", html or text, text, bold, italic)


def test_risks_split_on_the_main_heading_style_and_keep_subheadings_in_the_body():
    blocks = [
        B("Item 1A. Risk Factors", bold=True),
        B("STRATEGIC AND COMPETITIVE RISKS"),
        B("We face intense competition across all markets for our products and services.", bold=True),
        B("Competition in the technology sector", bold=True, italic=True),
        B("Our competitors range in size from diversified global companies to small firms."),
        B("Our cloud strategy requires substantial investments. Demand is evolving and may not meet expectations.",
          html="<b>Our cloud strategy requires substantial investments.</b> Demand is evolving and may not meet expectations."),
        B("Cyberattacks could lead to reduced revenue and increased costs.", bold=True),
        B("Threats to security can take a variety of forms."),
    ]
    risks = split(blocks, 0, len(blocks))
    assert [r["title"] for r in risks] == [
        "We face intense competition across all markets for our products and services.",
        "Our cloud strategy requires substantial investments.",
        "Cyberattacks could lead to reduced revenue and increased costs.",
    ]
    assert risks[0]["category"] == "STRATEGIC AND COMPETITIVE RISKS"
    assert "Competition in the technology sector" in risks[0]["text"]
    assert risks[1]["text"].startswith("Demand is evolving")
