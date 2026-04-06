# Test Results

This file records live retrieval outputs from the current MongoDB Atlas-backed corpus after the latest successful reseed.

Validation environment:

- Repository path: `/Users/varunreddyseelam/Desktop/medlaunch_AI`
- Build status: `npm run build` passed
- Seed status: `RESET_COLLECTION=true npm run seed` passed
- Retrieval backend: MongoDB Atlas `$vectorSearch` on `vector_index`
- Corpus size at validation time: `755` documents across `184` chapters

Commands used to capture these results:

```bash
node -e 'require("ts-node/register"); const svc=require("./src/services/standards.service"); (async()=>{const out=await svc.searchStandards("What are the staff competency assessment requirements?",5); console.log(out); process.exit(0);})().catch(err=>{console.error(err); process.exit(1);});'
```

```bash
node -e 'require("ts-node/register"); const svc=require("./src/services/standards.service"); (async()=>{const out=await svc.getStandardsByChapter("LS.2"); console.log(out); process.exit(0);})().catch(err=>{console.error(err); process.exit(1);});'
```

The outputs below are lightly trimmed to keep the document readable, but they are taken from live runs against the current data.

## Q&A Queries

### 1. Staff competency assessment

Query:

```text
What are the staff competency assessment requirements?
```

Observed output:

```text
source: healthcare-standards connector
mode: semantic-search

query: What are the staff competency assessment requirements?
matches: 8
retrieval_mode: vector-search

evidence 1
chapter_id: SM.7
section_name: Staffing Management
heading: SM.7 COMPETENCY ASSESSMENT AND PERFORMANCE APPRAISAL
chunk_id: SM_7_STANDARD
relevance_score: 0.7519
excerpt: SR.1 The organization shall conduct a performance appraisal ... SR.2 The organization shall perform competency assessments initially and on an ongoing basis ...
```

Result summary: retrieval correctly centered on `SM.7` and returned the standard, interpretive guidelines, and surveyor guidance for competency assessment.

### 2. Patient rights

Query:

```text
What do the standards say about patient rights?
```

Observed output:

```text
source: healthcare-standards connector
mode: semantic-search

query: What do the standards say about patient rights?
matches: 8
retrieval_mode: vector-search

evidence 1
chapter_id: PR.2
section_name: Patient Rights
heading: PR.2 SPECIFIC RIGHTS
chunk_id: PR_2_INTERPRETIVE_GUIDELINES_PART_008
relevance_score: 0.8184

evidence 3
chapter_id: PR.2
section_name: Patient Rights
heading: PR.2 SPECIFIC RIGHTS
chunk_id: PR_2_STANDARD_PART_001
relevance_score: 0.8083
excerpt: The organization shall protect and promote each patient’s rights ...
```

Result summary: retrieval correctly concentrated on `PR.2` and surfaced both the core standard and supporting guidance.

### 3. Hand hygiene

Query:

```text
Is there a chapter about hand hygiene?
```

Observed output:

```text
source: healthcare-standards connector
mode: semantic-search

query: Is there a chapter about hand hygiene?
matches: 8
retrieval_mode: vector-search

evidence 1
chapter_id: IC.1
section_name: Infection Prevention and Control Program
chunk_id: IC_1_STANDARD_PART_002
relevance_score: 0.7608
excerpt: ... SR.3f Hand hygiene compliance & monitoring; SR.3g Guidelines for the implementation of isolation precautions ...
```

Result summary: retrieval located hand-hygiene requirements under `IC.1` and associated monitoring language.

### 4. Medication errors

Query:

```text
What do the standards say about medication errors?
```

Observed output:

```text
source: healthcare-standards connector
mode: semantic-search

query: What do the standards say about medication errors?
matches: 8
retrieval_mode: vector-search

evidence 1
chapter_id: MM.6
section_name: Medication Management
heading: MM.6 OVERSIGHT GROUP
chunk_id: MM_6_STANDARD
relevance_score: 0.8152
excerpt: The medical staff is responsible for developing policies and procedures that minimize drug errors ... All medication related errors shall be tracked and analyzed ...
```

Result summary: retrieval correctly anchored on `MM.6` and returned policy, reporting, and error-analysis requirements.

### 5. Infection prevention program

Query:

```text
What does the infection prevention program require?
```

Observed output:

```text
source: healthcare-standards connector
mode: semantic-search

query: What does the infection prevention program require?
matches: 8
retrieval_mode: vector-search

evidence 1
chapter_id: IC.1
section_name: Infection Prevention and Control Program
chunk_id: IC_1_INTERPRETIVE_GUIDELINES_PART_005
relevance_score: 0.7887
excerpt: ... Adherence to CDC and other nationally recognized guidelines for infection prevention and control precautions; Education of patients, visitors, caregivers, and staff ...
```

Result summary: retrieval centered on `IC.1` and brought back the expected program scope, surveillance, sanitation, and training evidence.

## Citation Queries

### 1. Exact chapter lookup: LS.2

Query:

```text
Show me chapter LS.2 exactly
```

Observed output:

```text
source: healthcare-standards connector
mode: chapter-lookup

chapter: LS.2
exact_match: true

LS.2 POTENTIALLY INFECTIOUS BLOOD AND PRODUCTS
SR.1 If an organization regularly uses the services of an outside blood bank, it shall have an agreement ...
SR.2 The agreement shall require that the blood bank promptly notify the organization ...
```

Result summary: verbatim chapter reconstruction worked and preserved ordered SR content.

### 2. Exact chapter lookup: IC.1

Query:

```text
Show me chapter IC.1 exactly
```

Observed output:

```text
source: healthcare-standards connector
mode: chapter-lookup

chapter: IC.1
exact_match: true

IC.1 INFECTION PREVENTION AND CONTROL PROGRAM
SR.1 The IPCP shall provide the means for the surveillance, prevention, and control of HAIs ...
SR.2a An individual ... responsible for the IPCP ...
```

Result summary: exact chapter retrieval returned the standard body in order and without the overlap duplication seen in earlier revisions.

### 3. Exact chapter lookup: SM.7

Query:

```text
Show me chapter SM.7 exactly
```

Observed output:

```text
source: healthcare-standards connector
mode: chapter-lookup

chapter: SM.7
exact_match: true

SM.7 COMPETENCY ASSESSMENT AND PERFORMANCE APPRAISAL
SR.1 The organization shall conduct a performance appraisal ...
SR.2 The organization shall perform competency assessments initially and on an ongoing basis ...
SR.4 The organization shall aggregate objective performance data ...
```

Result summary: exact chapter retrieval returned the expected competency requirements and follow-on interpretive guidance.

### 4. Exact chapter lookup: PR.2

Query:

```text
Show me chapter PR.2 exactly
```

Observed output:

```text
source: healthcare-standards connector
mode: chapter-lookup

chapter: PR.2
exact_match: true

PR.2 SPECIFIC RIGHTS
SR.2 Patient participation and means for making informed decisions regarding his/her plan of care ...
SR.6 Provision of care in a safe setting ...
SR.10 Procedure for submission of a written or verbal grievance ...
```

Result summary: exact lookup returned the patient-rights chapter with actionable SR language.

### 5. Exact wording search: hand hygiene

Query:

```text
Show me the exact wording about hand hygiene
```

Observed output:

```text
source: healthcare-standards connector
mode: semantic-search

query: Show me the exact wording about hand hygiene
matches: 8
retrieval_mode: vector-search

direct_quotes:
quote 1
chapter_id: IC.1
text: o Promotion of hand washing hygiene among all staff and employees, including

quote 3
chapter_id: IC.1
text: SR.3f   Hand hygiene compliance & monitoring;
```

Result summary: quote extraction behaved as intended and returned direct phrasing instead of only broader semantic excerpts.

## Edge Cases

### 1. Out-of-domain query still returns nearest evidence

Query:

```text
What do the standards say about Martian clinical governance?
```

Observed output:

```text
source: healthcare-standards connector
mode: semantic-search

query: What do the standards say about Martian clinical governance?
matches: 8
retrieval_mode: vector-search

evidence 1
chapter_id: MS.1
section_name: Medical Staff
heading: MS.1 ORGANIZATION, ACCOUNTABILITY, AND RESPONSIBILITY

evidence 3
chapter_id: GB.2
section_name: Governing Body
heading: GB.2 LEGAL RESPONSIBILITY
```

Result summary: the system did not hallucinate a nonexistent chapter, but because the query overlaps with governance vocabulary it still returned nearest governance-related evidence. This is a residual relevance limitation worth calling out.

### 2. No section match

Query:

```text
list_sections("teleportation")
```

Observed output:

```text
source: healthcare-standards connector
mode: section-list

section_filter: teleportation
No matching sections or chapters found.
```

Result summary: no-match discovery behavior is explicit and clean.

### 3. Missing chunk ID

Query:

```text
get_standard_by_chunk_id("MS_8_001")
```

Observed output:

```text
source: healthcare-standards connector
mode: chunk-id-lookup
No standard found for chunk_id MS_8_001.
```

Result summary: missing exact identifiers fail safely with a direct not-found response.

## Additional Exact Lookup Check

Query:

```text
get_standard_by_chunk_id("MS_8_STANDARD")
```

Observed output:

```text
source: healthcare-standards connector
mode: chunk-id-lookup

document: NIAHO Standards
section: Medical Staff
chapter: MS.8
heading: MS.8 PERFORMANCE DATA
chunk_id: MS_8_STANDARD
```

Result summary: exact chunk lookup works when the requested `chunk_id` exists.