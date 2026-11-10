-- ============================================================================
-- ELLE LAW — DATABASE DDL & CROSS-DOMAIN REASONING ARCHITECTURE
-- Database: Cloudflare D1 "ellelaw" (UUID: f74bb25c-8d96-4193-bda7-90f7e5094099)
-- Target: Complete US Jurisprudence (50 States + Federal + SCOTUS) as of Sept 2026
-- ============================================================================

-- ── 1. LEGAL DOMAINS TAXONOMY ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_domains (
    id TEXT PRIMARY KEY,                       -- e.g. 'domain:fed:immigration', 'domain:fed:tax', 'domain:state:ca:civil'
    slug TEXT NOT NULL UNIQUE,                -- URL/agent query slug
    name TEXT NOT NULL,                        -- e.g. 'Federal Immigration & Nationality Law'
    category TEXT NOT NULL,                    -- 'substantive', 'procedural', 'constitutional', 'regulatory'
    jurisdiction_level TEXT NOT NULL,          -- 'federal', 'state', 'scotus', 'administrative', 'multistate'
    jurisdiction_code TEXT NOT NULL,           -- 'US', 'US-CA', 'US-NY', 'US-TX', etc.
    parent_domain_id TEXT,                     -- Hierarchical parenting
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_domain_id) REFERENCES legal_domains(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_domains_jurisdiction ON legal_domains(jurisdiction_level, jurisdiction_code);
CREATE INDEX IF NOT EXISTS idx_domains_category ON legal_domains(category);

-- ── 2. LEGAL DOCUMENTS MASTER REPOSITORY ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_documents (
    id TEXT PRIMARY KEY,                       -- Canonical UUID / Citation digest (e.g., 'doc:scotus:565us478')
    citation_primary TEXT NOT NULL,           -- Official reporter: '565 U.S. 478', '26 U.S.C. § 7206'
    citation_parallel TEXT,                    -- JSON array of alternate citations
    title TEXT NOT NULL,                       -- 'Kawashima v. Holder', 'Loper Bright Enterprises v. Raimondo'
    court_name TEXT,                           -- 'Supreme Court of the United States', 'United States Tax Court', etc.
    court_code TEXT,                           -- 'scotus', 'ca2', 'ca9', 'tax_court', 'bia', 'del_chancery'
    doc_type TEXT NOT NULL,                    -- 'judicial_opinion', 'statute', 'regulation', 'administrative_precedent', 'dissent'
    decision_date DATE,                        -- Date of judicial decision
    effective_date DATE,                       -- Effective date of statute/regulation
    status TEXT NOT NULL DEFAULT 'good_law',   -- 'good_law', 'overturned', 'abrogated', 'distinguished', 'questioned'
    overruled_by_id TEXT,                      -- Foreign key pointing to document that overruled this authority
    holding_summary TEXT,                      -- Core legal holding / syllabus
    full_text TEXT NOT NULL,                   -- Complete opinion / statutory text
    as_of_date DATE DEFAULT '2026-09-01',       -- Freshness milestone verification
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (overruled_by_id) REFERENCES legal_documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_docs_citation ON legal_documents(citation_primary);
CREATE INDEX IF NOT EXISTS idx_docs_court_date ON legal_documents(court_code, decision_date);
CREATE INDEX IF NOT EXISTS idx_docs_status ON legal_documents(status);

-- ── 3. SCOTUS SPECIFIC DISPOSITIONS & DISSENTS ──────────────────────────────
CREATE TABLE IF NOT EXISTS scotus_opinions (
    document_id TEXT PRIMARY KEY,
    outcome_type TEXT NOT NULL,                -- 'upheld', 'struck_down', 'affirmed', 'reversed', 'vacated_remanded'
    vote_split TEXT NOT NULL,                  -- '9-0', '6-3', '5-4', etc.
    majority_author TEXT,                      -- Justice authoring majority opinion
    concurring_justices TEXT,                  -- JSON array of concurring Justices
    dissenting_justices TEXT,                  -- JSON array of dissenting Justices
    dissent_text TEXT,                         -- Verbatim dissenting opinion text
    dissent_doctrinal_impact TEXT,             -- Explains circuit split impetus or future reconsideration theory
    statute_challenged TEXT,                   -- Specific statute under constitutional review
    constitutional_provision TEXT,             -- e.g., 'Art. I, Sec. 8', 'First Amendment', 'Fourteenth Amendment Due Process'
    FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scotus_outcome ON scotus_opinions(outcome_type);
CREATE INDEX IF NOT EXISTS idx_scotus_statute ON scotus_opinions(statute_challenged);

-- ── 4. DOCUMENT DOMAINS (THE CRITICAL MANY-TO-MANY BRIDGE) ───────────────────
-- This join table resolves cross-domain nexus (e.g. Tax case turning on Immigration)
CREATE TABLE IF NOT EXISTS document_domains (
    document_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    is_primary_domain BOOLEAN NOT NULL DEFAULT 0,    -- 1 if native to this silo, 0 if cross-cutting
    weight REAL NOT NULL DEFAULT 0.5,                -- 0.0 to 1.0 (substantive relevance score)
    cross_domain_trigger BOOLEAN NOT NULL DEFAULT 0, -- 1 IF CASE TURNS ON THIS CROSS-DOMAIN LEGAL QUESTION
    substantive_nexus_rationale TEXT,               -- EXPLICIT REASONING: Why this document has legal effect in target domain
    governing_statute_nexus TEXT,                   -- e.g., '26 U.S.C. § 7206 -> INA § 101(a)(43)(M)(i) (Tax fraud as CIMT/aggravated felony)'
    key_legal_concepts TEXT,                         -- JSON array: ["moral_turpitude", "aggravated_felony", "tax_fraud"]
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, domain_id),
    FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (domain_id) REFERENCES legal_domains(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_doc_domains_lookup ON document_domains(domain_id, cross_domain_trigger, weight);
CREATE INDEX IF NOT EXISTS idx_doc_domains_doc ON document_domains(document_id);

-- ── 5. AGENT DOMAIN SILOS & ENTITLEMENTS ────────────────────────────────────
-- Controls what each specialized agent sees and which cross-domain links bubble up
CREATE TABLE IF NOT EXISTS agent_domain_entitlements (
    agent_role TEXT NOT NULL,                  -- e.g., 'immigration_specialist', 'tax_specialist', 'criminal_defense_specialist'
    primary_domain_id TEXT NOT NULL,           -- The agent's native silo
    allow_cross_domain BOOLEAN NOT NULL DEFAULT 1, -- Can agent inspect cross-cutting edge cases?
    min_cross_domain_weight REAL NOT NULL DEFAULT 0.35, -- Minimum nexus weight required
    auto_escalate_constitutional BOOLEAN NOT NULL DEFAULT 1, -- Automatically include relevant SCOTUS rulings
    notes TEXT,
    PRIMARY KEY (agent_role, primary_domain_id),
    FOREIGN KEY (primary_domain_id) REFERENCES legal_domains(id) ON DELETE CASCADE
);

-- ── 6. CITATION & PRECEDENT GRAPH ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citation_graph (
    source_document_id TEXT NOT NULL,          -- Citing document
    target_document_id TEXT NOT NULL,          -- Cited document
    treatment_type TEXT NOT NULL,              -- 'followed', 'distinguished', 'criticized', 'overruled', 'cited'
    depth_of_treatment INTEGER DEFAULT 1,      -- 1 = passing mention, 4 = extensive doctrinal analysis
    PRIMARY KEY (source_document_id, target_document_id),
    FOREIGN KEY (source_document_id) REFERENCES legal_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (target_document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cit_graph_target ON citation_graph(target_document_id, treatment_type);
