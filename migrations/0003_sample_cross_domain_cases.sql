-- Sample Landmark Cross-Domain Precedents
-- Demonstrating how a Tax/Criminal Case turns on an Immigration legal nexus

-- 1. Kawashima v. Holder, 565 U.S. 478 (SCOTUS 2012)
INSERT OR IGNORE INTO legal_documents (
    id, citation_primary, citation_parallel, title, court_name, court_code, 
    doc_type, decision_date, status, holding_summary, full_text, as_of_date
) VALUES (
    'doc:scotus:565us478',
    '565 U.S. 478',
    '["132 S. Ct. 1166", "182 L. Ed. 2d 1"]',
    'Kawashima v. Holder',
    'Supreme Court of the United States',
    'scotus',
    'judicial_opinion',
    '2012-02-21',
    'good_law',
    'Convictions for subscribing to a false tax return (26 U.S.C. § 7206(1)) and aiding and assisting in the preparation of a false tax return (§ 7206(2)) constitute aggravated felonies under INA § 101(a)(43)(M)(i) where the revenue loss exceeds $10,000, subjecting noncitizens to mandatory deportation.',
    'JUSTICE THOMAS delivered the opinion of the Court. Under the Immigration and Nationality Act (INA), an alien who is convicted of an aggravated felony at any time after admission is deportable. 8 U.S.C. § 1227(a)(2)(A)(iii)...',
    '2026-09-01'
);

-- SCOTUS Details for Kawashima
INSERT OR IGNORE INTO scotus_opinions (
    document_id, outcome_type, vote_split, majority_author, dissenting_justices, 
    dissent_text, dissent_doctrinal_impact, statute_challenged, constitutional_provision
) VALUES (
    'doc:scotus:565us478',
    'upheld',
    '6-3',
    'Clarence Thomas',
    '["Ruth Bader Ginsburg", "Stephen Breyer", "Elena Kagan"]',
    'JUSTICE GINSBURG, with whom JUSTICE BREYER and JUSTICE KAGAN join, dissenting. The Court holds that tax offenses count as aggravated felonies under § 1101(a)(43)(M)(i)... But Congress dealt with tax evasion separately in subsection (M)(ii)...',
    'Ginsburg dissent argues that subsection (M)(ii) specifically covers tax evasion under 26 USC 7201 with a $10,000 threshold, and subsection (M)(i) was never intended to swallow ordinary filing violations under 7206 without an explicit statutory tax qualifier.',
    '26 U.S.C. § 7206; 8 U.S.C. § 1101(a)(43)(M)(i)',
    'Statutory Construction / INA Preemption'
);

-- Document Domains for Kawashima (Primary = Tax; Cross-Domain Trigger = Immigration!)
INSERT OR IGNORE INTO document_domains (
    document_id, domain_id, is_primary_domain, weight, cross_domain_trigger, 
    substantive_nexus_rationale, governing_statute_nexus, key_legal_concepts
) VALUES 
-- Native domain: Federal Tax
('doc:scotus:565us478', 'domain:fed:tax', 1, 0.90, 0, 'Direct interpretation of 26 U.S.C. § 7206(1) and (2) false corporate tax returns.', '26 U.S.C. § 7206', '["tax_fraud", "false_return", "revenue_loss"]'),
-- Cross-cutting nexus: Federal Immigration
('doc:scotus:565us478', 'domain:fed:immigration', 0, 0.98, 1, 'Tax conviction constitutes an aggravated felony involving fraud/deceit resulting in mandatory removal under INA 237(a)(2)(A)(iii).', '26 U.S.C. § 7206 -> 8 U.S.C. § 1101(a)(43)(M)(i)', '["aggravated_felony", "moral_turpitude", "deportability"]');

-- 2. Padilla v. Kentucky, 559 U.S. 356 (SCOTUS 2010)
INSERT OR IGNORE INTO legal_documents (
    id, citation_primary, citation_parallel, title, court_name, court_code, 
    doc_type, decision_date, status, holding_summary, full_text, as_of_date
) VALUES (
    'doc:scotus:559us356',
    '559 U.S. 356',
    '["130 S. Ct. 1473", "176 L. Ed. 2d 284"]',
    'Padilla v. Kentucky',
    'Supreme Court of the United States',
    'scotus',
    'judicial_opinion',
    '2010-03-31',
    'good_law',
    'The Sixth Amendment right to effective assistance of counsel requires criminal defense attorneys to inform noncitizen clients whether a guilty plea carries a risk of deportation.',
    'JUSTICE STEVENS delivered the opinion of the Court. The landscape of federal immigration law has changed dramatically over the last 90 years...',
    '2026-09-01'
);

-- Document Domains for Padilla (Primary = Criminal Law; Cross-Domain Trigger = Immigration!)
INSERT OR IGNORE INTO document_domains (
    document_id, domain_id, is_primary_domain, weight, cross_domain_trigger, 
    substantive_nexus_rationale, governing_statute_nexus, key_legal_concepts
) VALUES 
-- Native domain: Federal Criminal Law / 6th Amendment
('doc:scotus:559us356', 'domain:fed:criminal', 1, 0.85, 0, 'Sixth Amendment ineffective assistance of counsel standards in plea bargaining.', 'U.S. Const. amend. VI', '["ineffective_assistance", "plea_bargain", "strickland_test"]'),
-- Cross-cutting nexus: Federal Immigration
('doc:scotus:559us356', 'domain:fed:immigration', 0, 0.99, 1, 'Criminal plea counsel has constitutional duty to warn of clear immigration deportation consequences.', '8 U.S.C. § 1227(a)(2)(B)(i) <- U.S. Const. amend. VI', '["deportation_risk", "plea_advisal", "collateral_consequences"]');
