[MEASURED] Read all twelve faculty descriptions and regexes, inspected the twelve sensory briefs in batches 01/02, and checked old/new keyword counts without running routing or embeddings.
[OPEN] Literal structured-input extraction is underrepresented in the sensory cues; the proposed rewrite may improve routing, but no routing flip or description-only causal effect has been demonstrated.

# Sensory perception rewrite proposal — 2026-09-09

## Evidence and diagnosis

[MEASURED] `Elle/electron/native/providers/faculties.json` describes sensory perception as taking in images, screenshots, documents, pages, files and raw data, with observation, transcription and measurement before interpretation. Its regex includes `observe`, `transcribe`, selected visual nouns, `extract (the )?(text|table|fields)`, and `parse the (page|file)`. It does not generally recognize parsing supplied payloads, logs or rows, or extracting numerical readings. This is a source inspection finding, not an embedding measurement.

[MEASURED] `atlas13.cjs:386–389` scores each faculty as cosine similarity plus `0.12 * min(3, keyword matches) / 3`. At `:410–418`, the router subtracts scores within each antipodal pair and chooses the largest absolute axis coordinate. Release additionally requires COLLAPSE 0.06, MARGIN 0.02 and RATIO 1.3. `assign()` uses centred faculty/goal embeddings when available (`:615–625`). A keyword match is not a route, and the nearest individual faculty cosine is not the decision rule.

[DERIVED] The operation is the useful boundary: extracting observations already supplied in the request differs from retrieving past events, interpreting symbols for a reader, assessing present machine health, or explaining structural relationships. Logs and records supply episodic cues even when no recall is requested; temperatures supply somatic cues even when no health judgment is requested; tables and grids suggest language or spatial structure even when the task only asks for faithful extraction. The description mentions raw data but spends more explicit vocabulary on visual/document input than on structured textual observation. These facts motivate the hypothesis; they do not establish the encoder's causal mechanism.

[MEASURED] All twelve competing descriptions were inspected. Their operations are: motor—execute/edit; somatic—assess machine condition; language—write/translate/summarise; episodic—recall/search history; predictive—plan/forecast; convergent—calculate/prove; divergent—generate alternatives; valuation—rank/choose; social—understand other minds; spatial—structure/relationships; metacognitive—review/calibrate. Sensory should preserve the supplied observations, regardless of their topic. Verification scripts in the posted briefs introduce execution/checking vocabulary across these tasks.

[MEASURED] `ROUTING_002_recenter.md`, sections “Which misses”/contingency and “BATCH-02 HELD OUT,” reports six sensory off-ceiling failures in each batch, among 14 and 13 overall respectively. These are inherited measurements, not rerun here. Each JSONL has exactly six sensory rows, lines 1–6. The record names competing destinations collectively; it does not give an exact destination per row. None is invented below.

[DERIVED] Correction to the record's causal wording: two batches support a recurring failure, not “a measured property of the description” alone. The fixed encoder, keyword layer, paired scoring and generation process are confounded. Batch-02's six sensory rows are one near-identical template with changed topic labels and values; they are not six independent demonstrations of generalization. A controlled intervention is necessary to assign cause.

## Candidate to freeze before validation

[DESIGN CHOICE] Proposed description (literal replacement text; not installed):

> Observing and faithfully extracting what is present in supplied input: images, screenshots, pages, documents, files, raw text and structured data. Read or parse supplied logs, tables, delimited rows, key-value payloads, telemetry, grids and byte dumps; transcribe visible text, fields, values and positions while preserving their order, precision and identity. The result reports the supplied observations, including faithful conversion to a requested representation. The task is literal observation and extraction before explanation, diagnosis, calculation, planning or action.

[DESIGN CHOICE] Proposed keywords regex below is a regex source, passed to `new RegExp(source, 'i')` by the loader and `'gi'` by scoring. Backslashes must be JSON-escaped if the owner transfers it to `faculties.json`. Existing sensory alternatives are retained to limit loss of visual coverage; new alternatives require extraction/parsing contexts except the descriptive `hex dump` cue. This is a deliberately provisional candidate developed using batches 01/02, not validated on them.

```regex
\b(image|screenshot|photo|picture|look at|read the (page|file|document|screen)|extract (the )?(text|table|fields)|ocr|transcribe|describe what (you|is) (see|shown)|observe|vision|visual|parse the (page|file)|pars(?:e|ing) (?:the |a |an )?(?:raw |structured |tabular |plain text |complex |multi-system )?(?:data|payload|log|rows?|table|csv|json|sensor|telemetry|hex)|extract (?:the |all |every )?(?:raw |numerical |floating-point )?(?:observations?|key-value pairs?|fields?|values?|readings?|metrics?|latency|temperature|benchmark scores?|hexadecimal bytes?)|scan each row|inspect (?:the )?(?:raw text|ascii)|hex dump)\b
```

[OPEN] The regex can match quoted instructions or incidental descriptions, including “hex dump” in a non-extraction request. It does not understand negation or task intent. Narrow vocabulary can also miss new paraphrases. These are falsifiable limitations to assess on withheld tasks, not reasons to claim semantic classification from matching alone.

## Exact rationale for the twelve expected flips

[MEASURED] Counts below use the actual posted-text construction from `routing-recenter.cjs:73`: title, trimmed brief, then `Self-check before you finish: ` plus trimmed verify text. Counts are capped at three, exactly as the scorer does. JavaScript regex syntax compiled successfully. Across the other 120 rows of batches 01/02, the candidate caused zero increases in sensory keyword count. This is a development-set lexical check only.

[OPEN] Every “flip rationale” below is a prediction about the intended operation, not a measured new route. [DERIVED] The listed keyword score increments affect the sensory-minus-motor axis with all embeddings and other regexes held fixed. They cannot guarantee rank-1 or release; the proposed description's cosine changes remain unmeasured.

| Source line and exact title | [MEASURED] capped hits old → candidate | [DERIVED] keyword increment | [OPEN] Specific reason the intended sensory route should improve |
|---|---:|---:|---|
| 01:1 Extract Metric Values from Log Lines | 0 → 3 | +0.12 | Copy the supplied latency tokens in order; no historical search or arithmetic is requested. Explicit log parsing and value extraction cues counter the three existing episodic matches. |
| 01:2 Transcribe Tabular CSV Data Stream | 2 → 3 | +0.04 | Copy headers and values into JSON while retaining identity, rather than write explanatory prose. Faithful representation conversion is explicitly included in the new description. |
| 01:3 Parse Multi-System Sensor Payload | 0 → 1 | +0.04 | Extract temperature, humidity and the already assigned flag by system ID. No diagnosis of machine condition is needed; “telemetry” and “readings” become observation examples. |
| 01:4 Inspect ASCII Disk Map Grid | 0 → 2 | +0.08 | Report occupied positions read from the supplied rows. No reallocation, topology inference or capacity assessment is requested; grids and positions are explicitly within literal extraction. |
| 01:5 Transcribe Multi-Column Benchmark Matrix | 1 → 3 | +0.08 | Copy model-score associations in header order; no ranking or benchmark interpretation is requested. The description names tables and preservation of numerical precision. |
| 01:6 Parse Complex Hex Dump Header | 0 → 2 | +0.08 | Copy the byte-token column while omitting offsets and ASCII, rather than interpret the file format. Byte dumps and identity-preserving extraction are explicit. |
| 02:1 Parse Data Payload Batch 01 | 1 → 3 | +0.08 | Copy the supplied ValA/ValB/Status/Code pairs; “Data Record” does not request memory retrieval. Raw observations and key-value extraction now receive direct cues. |
| 02:2 Parse Writing Payload Batch 01 | 1 → 3 | +0.08 | The label “writing” changes no requested operation: copy the same supplied pairs. The new description ties representation to extraction, not prose authorship. |
| 02:3 Parse Planning Payload Batch 01 | 1 → 3 | +0.08 | “Planning” is a payload topic; no future steps or schedule are requested. Preserve the visible pairs rather than forecast. |
| 02:4 Parse Science Payload Batch 01 | 1 → 3 | +0.08 | No scientific derivation or hypothesis is requested; reproduce supplied pairs exactly. Explicit structured-input extraction should dominate the topic. |
| 02:5 Parse Operations Payload Batch 01 | 1 → 3 | +0.08 | No operational action is requested. The Python self-check is ancillary to extraction, although its motor keyword vote remains. |
| 02:6 Parse Finance Payload Batch 01 | 1 → 3 | +0.08 | No financial calculation or valuation is requested; faithfully extract the same fields. Topic-independent observation is the proposed boundary. |

[MEASURED] Two source-quality issues weaken any claim of clean labels: batch-01 line 5 asks for floating-point scores “across all five columns,” but one column is the model name and only four are numeric. Line 6's verification expects 48 bytes, but the visible byte columns contain 16 + 14 + 14 = 44 tokens. Neither source was changed. Batch-02 titles ending “Batch 01” are retained verbatim; file identity determines the batch.

## Refutation conditions and handoff validation

[DESIGN CHOICE] The owner should freeze this single candidate and run one paired evaluation on untouched batch-03, using identical posted text, encoder configuration, frozen batch-01 centreMu, other faculty definitions, and collapse thresholds across arms. Batch-03 has not been opened here, including its labels or cached embeddings. No embedding or routing module was executed, no service was contacted, and no live atlas was read or rebuilt.

[DESIGN CHOICE] Separate four arms: unchanged baseline; description-only; regex-only; both. Refresh the candidate description embedding explicitly in isolated evaluation state for arms that change it; verify the old cached faculty embedding is not silently reused. Do not install or rebuild the shared atlas to perform this comparison. The owner controls that state and GPU. This proposal does not authorize this assistant to operate them.

[DESIGN CHOICE] Report per-row signed coordinates, intended rank, held/released and assigned pole; sensory rank-1 and released accuracy; non-sensory new false releases into sensory; total hit/held/wrong counts. Declare the candidate provisionally successful only if sensory rank-1 and total correct releases increase, with no increase in total wrong releases or new non-sensory false releases into sensory. This is a conservative proposed acceptance rule, not an already agreed project gate. Publish the four arms even if none passes.

[OPEN] A description-only failure to improve sensory rank-1 on batch-03 refutes the proposed description's benefit on that held-out set; improvement solely in the regex arm would not validate the description mechanism. Unchanged or worse combined results refute this candidate's expected benefit on that set. New topic-driven false releases break the proposed operational boundary. A small batch cannot establish broad generality even if it passes.

[DESIGN CHOICE] No additional tuning against batch-03 after seeing its results; reject or record the result, and preregister a fresh independent holdout before any next revision. Batches 01/02 are development evidence only. The twelve individual predictions remain untested on their original rows because no new routing was performed.

[DERIVED] Geometry status for this proposal is INSTRUMENTATION, not MECHANISM: the inspected decision calculation is reproducible with flat cosine scores, bounded keyword votes and signed differences. No measurement here demonstrates an advantage unavailable to a flat build. A controlled geometry-specific advantage would be required to change that status.

[MEASURED] Scope completed: T1 only, selected first under the supplied priority order. T2–T4 were not undertaken. Only new Markdown deliverables were created; existing repository files, shared state, git and model services were left untouched.

## Source fingerprints

[MEASURED] SHA-256 fingerprints taken from the inspected source files at proposal creation (concurrent owners may subsequently change them):

- `Elle/electron/native/providers/faculties.json` — `df29b367cd8a560aac9880bba59a61716a6abef187e971b45175b4a6297a55ac`
- `Elle/electron/native/providers/atlas13.cjs` — `34590d3990e2431ee980eb443b5f9a1d3178abf991fb29d691d9f591547346d6`
- `elle-worker/research/seam-wire/briefs/gemini-batch-01.jsonl` — `e876b91803f50fccc4f9f221d6713f26f81daefd642a9edece61aab181a50e5b`
- `elle-worker/research/seam-wire/briefs/gemini-batch-02.jsonl` — `294ba75a0e5aa7d149375a21ea81c62089b84b27f20b803f3f07784e81f42932`
- `elle-worker/research/seam-wire/ROUTING_002_recenter.md` — `06087eaf259cabfe1f518e74a90d1c9d9c18fe92bcf87a019d4bdc8f71bbfa7f`
