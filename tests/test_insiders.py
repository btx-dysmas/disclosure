from disclosure.insiders import parse

FORM4 = b"""<?xml version="1.0"?>
<ownershipDocument>
  <aff10b5One>1</aff10b5One>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001197647</rptOwnerCik><rptOwnerName>KRESS COLETTE</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>EVP &amp; Chief Financial Officer</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-09-15</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>180.50</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>795340</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>"""


def test_form4_sale_under_a_10b5_1_plan():
    [t] = parse(FORM4, {"accession": "0001197647-26-000001", "filed": "2026-09-17"})
    assert t["owner"] == "KRESS COLETTE" and t["role"] == "EVP & Chief Financial Officer"
    assert t["code"] == "S" and t["type"] == "Open-market sale" and not t["acquired"]
    assert t["value"] == 180500 and t["after"] == 795340 and t["plan"] and t["direct"]
