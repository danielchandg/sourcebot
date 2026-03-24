# Academic Paper Summaries for Zoekt Search Ranking Project

These summaries cover the parts relevant to implementing search ranking improvements in Zoekt, specifically: import-graph PageRank, BM25 for code search, and NDCG-based evaluation. Read these instead of reading the papers.

---

## 1. Bajracharya et al. — "A Study of Ranking Schemes in Internet-Scale Code Search" (2007)

**Citation**: S. Bajracharya, T. Ngo, E. Linstead, P. Rigor, Y. Dou, P. Baldi, and C. Lopes. "A Study of Ranking Schemes in Internet-Scale Code Search." Technical Report UCI-ISR-07-8, UCI Institute for Software Research, November 2007.

**PDF**: https://isr.uci.edu/sites/isr.uci.edu/files/techreports/UCI-ISR-07-8.pdf

### What this paper does

This is the most directly relevant paper to your project. The authors built Sourcerer, a code search engine that indexed 1,555 open-source Java projects (254,000 classes, 17 million lines of code), and systematically compared four ranking heuristics for code search results. The central question is: "When a developer searches for code, how should we order the results so the most useful code appears first?"

### The four ranking heuristics they tested

**Heuristic 1 — Baseline (TF-IDF on code-as-text):** They fed raw source code files into Apache Lucene and used standard TF-IDF ranking. This is essentially a "glorified grep" — it treats code as plain text with no awareness of code structure. This is roughly what Zoekt does today without BM25 enabled.

**Heuristic 2 — FQNs only (Fully Qualified Names):** Instead of indexing all text in a file, they only indexed the names of packages, classes, and methods. The insight is that developers follow naming conventions, so the *names* of code entities carry most of the semantic information. Everything else (comments, variable assignments, string literals) is mostly noise for search purposes. They found this performed almost identically to the baseline, which proved that entity names contain virtually all the useful search information in source code.

**Heuristic 3 — Specificity (right-hand-side boosting):** In a fully qualified name like `org.apache.commons.collections.buffer.BoundedFifoBuffer`, the rightmost part (`BoundedFifoBuffer`) is the most specific and meaningful, while the leftmost parts (`org`, `apache`, `commons`) are generic and shared across thousands of classes. This heuristic boosts matches that appear toward the right-hand side of qualified names. This was the single most impactful heuristic — it alone jumped recall from 32% to 63% in the top 10 results.

**Heuristic 4 — Popularity (CodeRank / PageRank):** They built a directed graph where nodes are code entities (classes, methods, fields) and edges represent usage relationships (class A calls a method in class B, class A extends class B, etc.). They then ran Google's PageRank algorithm on this graph with a damping factor of 0.85. The resulting score is called "CodeRank" — classes that are used by many other classes (especially by other popular classes) get a high CodeRank. This is a direct measure of code reuse: foundational library classes rank high, while obscure one-off classes rank low.

### How they combined the heuristics

They tested five ranking schemes:

1. **Baseline** (Heuristic 1 alone)
2. **FQNs** (Heuristic 2 alone)
3. **FQNs + CodeRank** (Heuristics 2 + 4)
4. **FQNs + right-hand-side boost** (Heuristics 2 + 3)
5. **All combined** (Heuristics 2 + 3 + 4)

Critically, CodeRank was NOT used as a primary ranking signal. Instead, results were first ranked by TF-IDF content relevance, then partitioned into bins of k results with similar TF-IDF scores, and CodeRank was used as a secondary sort within each bin. This "binning" approach ensures that content relevance remains the primary signal, with popularity acting as a tiebreaker among similarly-relevant results.

### Results

| Ranking Scheme | Recall in Top 10 | Recall in Top 20 |
|---|---|---|
| Baseline (code-as-text TF-IDF) | 30% | 44% |
| FQNs only | 32% | 42% |
| FQNs + CodeRank | 40% | 44% |
| FQNs + right-hand-side boost | 63% | 74% |
| All combined | **67%** | **74%** |

The best scheme combined all heuristics — text relevance, name specificity boosting, and graph-based popularity. The individual contributions of each heuristic were additive.

### Their evaluation methodology (important for your project)

They defined 10 "control queries" designed to represent typical developer search intents, ranging from simple (searching for a bounded buffer implementation) to complex (searching for a complete FTP server). For each query, a group of 5 expert Java developers hand-picked the N best results (between 3 and 10 per query, 57 total across all queries). They then measured where each ranking scheme placed these "best hits" in the results list.

Their primary metric was **recall within the top N positions**: what fraction of the human-judged best hits appear in the top 10 or top 20 results? This is simpler than NDCG but captures the same idea — a good ranking scheme puts the best results near the top.

### What this means for your project

You are essentially replicating this paper's methodology inside Zoekt, adapted for your corpus (pret Pokemon repos instead of Java projects) and with a simplified dependency graph (file-level imports instead of class-level usage relationships). You should:

- Implement BM25 as your baseline (Zoekt already has this)
- Build an import-graph PageRank as your popularity signal
- Combine them using the binning approach (content relevance as primary, PageRank as tiebreaker)
- Define 15-20 control queries against the pret corpus with hand-judged best hits
- Measure recall@10 and/or NDCG@10 before and after

---

## 2. Inoue et al. — "Component Rank: Relative Significance Rank for Software Component Search" (2003)

**Citation**: K. Inoue, R. Yokomori, H. Fujiwara, T. Yamamoto, M. Matsushita, and S. Kusumoto. "Component Rank: Relative Significance Rank for Software Component Search." In *Proceedings of the 25th International Conference on Software Engineering (ICSE'03)*, pp. 14–24, IEEE, 2003.

### What this paper does

This is the foundational paper that first applied PageRank to software component search. The authors built SPARS-J (Software Product Archive and Retrieval System for Java), a search system for finding reusable Java components. Their key insight is that components (classes) that are widely used by other components are more likely to be useful to a developer searching for code.

### How Component Rank works

They model a software repository as a **weighted directed graph** called a "use-relation graph":

- **Nodes** are software components (Java classes)
- **Edges** represent usage relationships: if class A calls a method in class B, imports class B, extends class B, etc., there is an edge from A to B
- **Edge weights** represent the strength of the usage (how many times A references B)

They then run a modified PageRank on this graph. The key modification from standard web PageRank is a **pre-processing step** that clusters similar/duplicate code before computing ranks. This prevents copy-pasted code from artificially inflating rank scores (if someone copies a popular class into 100 projects, it shouldn't get 100x the rank).

The Component Rank formula is identical to PageRank: `CR(A) = (1 - d) + d * Σ(CR(Ti) / C(Ti))` where Ti are the components that use A, C(Ti) is the number of outgoing links from Ti, and d is the damping factor (0.85).

### Results and findings

They tested on 3,910 Java programs containing 188,247 classes. They found that:

- Classes with high Component Rank tended to be general-purpose utility classes (like collections, I/O utilities, logging frameworks) — exactly the kind of foundational code a developer would want to find
- Classes with low Component Rank tended to be application-specific code that wouldn't be useful to other developers
- Using Component Rank as a ranking signal significantly improved the relevance of search results compared to simple keyword matching

### What this means for your project

Your import-graph PageRank is a simplified version of Component Rank. Instead of analyzing class-level usage relationships (which requires type resolution and a full Java parser), you're analyzing file-level import/include relationships (which can be extracted with regex). You should cite this paper as the origin of the idea and note that your approach is a "lightweight, language-agnostic variant of Component Rank that operates at file granularity using syntactic import analysis rather than semantic usage relationships."

---

## 3. Neate et al. — "CodeRank: A New Family of Software Metrics" (2006)

**Citation**: B. Neate, W. Irwin, and N. Churcher. "CodeRank: A New Family of Software Metrics." In *Proceedings of the Australian Software Engineering Conference (ASWEC'06)*, pp. 369–378, 2006.

**Link**: https://www.researchgate.net/publication/4234310_CodeRank_a_new_family_of_software_metrics

### What this paper does

This paper extends the Component Rank idea by proposing CodeRank as a general-purpose *software metric* (not just a search ranking signal). They argue that PageRank, when applied to the dependency graph of a software system, reveals important structural properties that traditional metrics (lines of code, cyclomatic complexity, coupling, cohesion) cannot capture.

### Key concepts

CodeRank captures a notion of **transitive importance**: a class is important not just because many other classes depend on it directly, but because it is depended upon (directly or transitively) by other important classes. This is the same insight as web PageRank — a page is important not just because it has many links, but because *important* pages link to it.

They implemented a tool called CODERANKER that computes CodeRank metrics using a "full semantic model" — parsing source code to extract all dependency relationships (inheritance, method calls, field access, type references) and building a complete dependency graph.

### What this means for your project

CodeRank and Component Rank are essentially the same idea with different names from different research groups. You can cite both papers and use "CodeRank" as the term since it's more intuitive. The key takeaway is that PageRank on dependency graphs is a well-established idea in software engineering research, validated by multiple independent groups — you're not inventing a novel metric, you're implementing a known-good technique in a new context (Zoekt/trigram code search).

---

## 4. Robertson et al. — BM25: "The Probabilistic Relevance Framework" (2009)

**Citation**: S.E. Robertson and H. Zaragoza. "The Probabilistic Relevance Framework: BM25 and Beyond." *Foundations and Trends in Information Retrieval*, 3(4):333–389, 2009.

**Original BM25 paper**: S.E. Robertson, S. Walker, S. Jones, M. Hancock-Beaulieu, and M. Gatford. "Okapi at TREC-3." In *Proceedings of the Third Text REtrieval Conference (TREC-3)*, 1994.

### What BM25 is

BM25 (Best Matching 25) is a ranking function that scores documents based on how relevant they are to a search query. It is the standard baseline for information retrieval and has been the default ranking algorithm in systems like Elasticsearch, Apache Lucene, and now Zoekt for decades.

### The BM25 formula

For a query Q containing terms q1, q2, ..., qn, the BM25 score of a document D is:

```
Score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgdl))
```

Where:
- **f(qi, D)** = frequency of term qi in document D (how many times the search term appears)
- **|D|** = length of document D (in words/tokens)
- **avgdl** = average document length across the corpus
- **k1** = term frequency saturation parameter (typically 1.2–2.0). Controls how quickly additional occurrences of a term stop contributing to the score. A file that mentions "malloc" 500 times is not 100x more relevant than one that mentions it 5 times.
- **b** = document length normalization parameter (typically 0.75). Controls how much longer documents are penalized. Without this, long files would dominate results simply because they contain more terms.
- **IDF(qi)** = inverse document frequency of term qi, defined as `log((N - n(qi) + 0.5) / (n(qi) + 0.5))` where N is the total number of documents and n(qi) is the number of documents containing qi. Rare terms (appearing in few documents) contribute more to the score than common terms (appearing in many documents).

### Why BM25 matters for code search

BM25's three core ideas are all directly applicable to code:

1. **Term frequency saturation**: A file that mentions `battle` 50 times (because it's a battle system file) should rank higher than one that mentions it once, but not 50x higher. The saturation function handles this gracefully.

2. **Document length normalization**: Code files vary hugely in length — a 10-line header file and a 5,000-line implementation file should be scored fairly. Without normalization, the 5,000-line file would dominate results for any query term it contains, even if the term is incidental.

3. **Inverse document frequency**: Terms like `include`, `return`, `int` appear in virtually every C file and carry almost no search value. Rare terms like `pokedex_data` or `evolution_table` are highly discriminative. IDF naturally downweights common terms and upweights rare ones.

### BM25F — the multi-field extension

BM25F extends BM25 to handle documents with multiple "fields" of varying importance. For code search, the relevant fields are:

- **File name / path** (most important — a file called `battle.c` is highly relevant to a search for "battle")
- **Symbol definitions** (function names, struct names — these are deliberate developer-chosen names)
- **Code body** (the actual code text — useful but noisy)
- **Comments** (sometimes useful, often noise)

BM25F assigns different weights to each field, so a match in the file name contributes more to the score than a match buried in a comment. Sourcegraph implemented BM25F in their 6.2 release and reported a ~20% improvement in search quality across all metrics compared to baseline ranking.

### What this means for your project

Zoekt already has a `UseBM25Scoring` option. Your baseline should be Zoekt with BM25 enabled. The improvement you're measuring is what happens when you *add* PageRank on top of BM25. If Zoekt's BM25 implementation supports weighted fields, you could also experiment with boosting file name matches over code body matches, similar to BM25F.

---

## 5. Järvelin & Kekäläinen — "Cumulated Gain-Based Evaluation of IR Techniques" (2002)

**Citation**: K. Järvelin and J. Kekäläinen. "Cumulated Gain-Based Evaluation of IR Techniques." *ACM Transactions on Information Systems*, 20(4):422–446, 2002.

### What this paper does

This is the paper that introduced **NDCG (Normalized Discounted Cumulative Gain)**, the standard metric for evaluating ranked search results. You need this to evaluate whether your ranking improvements actually work.

### The problem NDCG solves

Simple metrics like precision ("what fraction of returned results are relevant?") and recall ("what fraction of relevant results were returned?") don't account for the *position* of results. If the 10 best results are at positions 1-10, that's much better than if they're at positions 91-100, but precision@100 and recall@100 would be identical in both cases.

### How NDCG works

**Step 1 — Assign relevance grades.** For each query, a human judge assigns a relevance score to each result. Typically this is on a scale like: 0 = irrelevant, 1 = marginally relevant, 2 = relevant, 3 = highly relevant.

**Step 2 — Compute DCG (Discounted Cumulative Gain).** Sum up the relevance scores, but apply a logarithmic discount based on position:

```
DCG@k = Σ(i=1 to k) relevance(i) / log2(i + 1)
```

A highly relevant result at position 1 contributes `3 / log2(2) = 3.0` to DCG, but the same result at position 10 contributes only `3 / log2(11) = 0.87`. This captures the intuition that results appearing earlier are more valuable to the user.

**Step 3 — Compute IDCG (Ideal DCG).** This is the DCG you'd get if results were perfectly ordered by relevance. Sort all judged results by relevance score (highest first) and compute DCG on that ideal ordering.

**Step 4 — Normalize.** NDCG@k = DCG@k / IDCG@k. This gives a value between 0 and 1, where 1 means perfect ranking.

### Example

Suppose for the query "battle damage" against the pret corpus, a human judge rates the top 5 results:

| Position | File | Relevance |
|---|---|---|
| 1 | `pokered/engine/battle/core.asm` | 3 (highly relevant) |
| 2 | `pokered/data/moves/moves.asm` | 1 (marginally relevant) |
| 3 | `pokecrystal/engine/battle/effect_commands.asm` | 3 (highly relevant) |
| 4 | `pokeemerald/src/battle_main.c` | 3 (highly relevant) |
| 5 | `pokered/audio/sfx/battle_sounds.asm` | 0 (irrelevant) |

DCG@5 = 3/log2(2) + 1/log2(3) + 3/log2(4) + 3/log2(5) + 0/log2(6) = 3.0 + 0.63 + 1.5 + 1.29 + 0 = 6.42

If the ideal ordering put the three "3" scores first, then the "1", then the "0":
IDCG@5 = 3/log2(2) + 3/log2(3) + 3/log2(4) + 1/log2(5) + 0/log2(6) = 3.0 + 1.89 + 1.5 + 0.43 + 0 = 6.82

NDCG@5 = 6.42 / 6.82 = 0.941

That's a pretty good ranking! If the irrelevant result had been at position 1 instead, NDCG would drop significantly.

### What this means for your project

Use NDCG@10 as your primary evaluation metric. For each of your ~20 control queries:

1. Run the query under each ranking scheme (BM25 baseline, BM25 + PageRank, PageRank only)
2. Take the top 10 results from each scheme
3. Have yourself (or ideally multiple team members) assign relevance grades (0-3) to each result
4. Compute NDCG@10 for each scheme
5. Report mean NDCG@10 across all queries

Show that BM25 + PageRank achieves higher mean NDCG@10 than BM25 alone.

---

## 6. Page et al. — "The PageRank Citation Ranking" (1998)

**Citation**: L. Page, S. Brin, R. Motwani, and T. Winograd. "The PageRank Citation Ranking: Bringing Order to the Web." Stanford Digital Library Working Paper SIDL-WP-1999-0120, 1998.

### What this paper does

This is the original Google PageRank paper, included for completeness since every paper above cites it. The core idea: model the web as a directed graph (pages are nodes, hyperlinks are edges), then compute the stationary distribution of a random walk on this graph. Pages that are linked to by many other pages (especially by other high-PageRank pages) have a higher probability in the stationary distribution, and are therefore ranked higher.

### The PageRank formula

```
PR(A) = (1 - d) + d * Σ(PR(Ti) / C(Ti))
```

Where:
- PR(A) = PageRank of page A
- d = damping factor (0.85). Represents the probability that a random surfer will continue following links rather than jumping to a random page.
- Ti = pages that link to A
- C(Ti) = number of outgoing links from Ti

The (1 - d) term handles "sinks" (pages with no outgoing links) and ensures the random walk is ergodic (can reach any page from any other page).

### The algorithm

1. Initialize all PageRank values to 1/N (uniform distribution)
2. Iteratively apply the formula until convergence (typically 50-100 iterations)
3. Convergence is reached when the maximum change in any node's PageRank between iterations falls below a threshold (e.g., 0.0001)

### What this means for your project

You implement this exact algorithm on your import graph. Nodes are files, edges are import/include relationships. Use d = 0.85 and iterate until convergence. There are existing Go libraries that implement this (e.g., `github.com/tubbynotori/pagerank`) so you don't need to implement it from scratch.

---

## 7. Sourcegraph Blog Posts (not academic papers, but directly relevant practical references)

### "Ranking in a Week" (Sourcegraph, 2022)
**URL**: https://sourcegraph.com/blog/ranking-in-a-week

**Key practical insight**: They built PageRank over a code symbol graph where edges connect files that reference symbols defined in other files. They tried three graph variants: directed (A→B when A references B's symbols), reverse-directed, and undirected. **Undirected worked best** because directed graphs over-ranked auto-generated files with tons of definitions (e.g., protobuf code gen) — everything imports them, so they get very high PageRank. But these auto-generated files are not what developers want to find. Conversely, `main.go` files import everything but nothing imports them, so directed PageRank ranks them very low — even though they're often exactly what a developer wants.

**What this means for your project**: You will likely hit this same problem with the pret corpus. Files like `constants/pokemon_constants.asm` will have extremely high PageRank because every other file includes them, but they're just constant definitions — not necessarily what a searcher wants. Meanwhile, high-level game logic files (battle engine, overworld scripts) might have low PageRank because they include lots of files but few files include them. Consider testing both directed and undirected graph variants and reporting which performs better.

### "Keeping it Boring (and Relevant) with BM25F" (Sourcegraph, 2025)
**URL**: https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f

**Key practical insight**: Sourcegraph implemented BM25F (BM25 with weighted fields) and saw ~20% improvement across search quality metrics. The key challenge they faced is that BM25 was designed for natural language text, where all words are equally "meaningful." In code, matches on file names and symbol definitions are far more meaningful than matches in code body or comments. BM25F solves this by assigning different weights to different fields.

They also found that for code search specifically, the document length normalization parameter (b) needed careful tuning — code files have very different length distributions than natural language documents.

### "Zoekt Memory Optimizations for Sourcegraph Cloud" (Sourcegraph, 2021)
**URL**: https://sourcegraph.com/blog/zoekt-memory-optimizations-for-sourcegraph-cloud

Not directly relevant to ranking, but useful context for understanding Zoekt's architecture. The key insight for your project: Zoekt stores index shards as memory-mapped files, and the PageRank scores you compute could be stored alongside the index metadata in these shard files. This is how Sourcegraph stores their own ranking signals — they're pre-computed during indexing and loaded at search time.

# General roadmap

1. The baseline is Zoekt without BM25 enabled. Use this as the "control group", then add CodeRank on top of it. The EASIEST implementation is to randomly shuffle the results.

2. BM25 is free with Zoekt; just enable it.

2. FQNs only: Only index the names of packages, classes, and methods. Ignore comments, variable assignments, and string literals. 
  - Only include "code" languages. Ignore variable names, strings, and comments.
  - Included languages: C++, TSX, Javascript, Java, C, Python, TypeScript, TSX, Rust, Objective-C++, Kotlin, Objective-C
  - All other languages should be ignored.
  - Ignoring comments and string literals:
    - For each multiline comment, ignore all characters between `/*` and `*/`, between ''' and ''', between """ and """
    - For each line, ignore all characters after the double forward slash comment delimiter `//`
    - Ignore characters in strings between quotation marks "", single quotes '', or tildes ``
  - Ignoring variables and variable assignments:
    - Non-trivial; maybe just implement for C++. A good query to benchmark is "graph".

3. Right-hand-side-boosting

Implement this only in includes most likely

# CodeRank

I only want to do 

"They then run a modified PageRank on this graph. The key modification from standard web PageRank is a **pre-processing step** that clusters similar/duplicate code before computing ranks. This prevents copy-pasted code from artificially inflating rank scores (if someone copies a popular class into 100 projects, it shouldn't get 100x the rank)."

# Queries

## GomoryHu
31 results
### Top N results
- Stonefeang/librewoosh Gomory_Hu.cpp
- bqi343/cp-notebook GomoryHu.h
- kth-competitive-programming/kactl GomoryHu.h
- ngthanhtrung23/ACM_Notebook_new GomoryHu.h
- fishy15/kactl GomoryHu.h
- wesley-a-leung/Resources GomoryHu.h
- tfg50/Competitive-Programming GomoryHu.hpp

### NDCG ranking (0 = irrelevant, 1 = marginally relevant, 2 = relevant, 3 = highly relevant)
- 3: Stonefeang, bqi343, tfg50, wesley-a-leung
- 2: fishy15 (GomoryHu.h, GomoryHu.cpp), kactl
- 1: KacperTopolski, ahsoltan, any stress test, cuber2460, fishy15 (GlobalMinCut.h), kactl (GlobalMinCut.h), OmeletWithoutEgg, dnx04
- 0: anything else

## Gaussian elimination
21 results
### Top N results
- 12tqian matrix2.hpp
- defnotmee
- iagorrr
- perdiDev cpp, java
- stevenhalim cpp, py, java
- wesley-a-leung
- NyaanNyaan

### NDCG ranking
- 3: 12tqian (matrix2.hpp), defnotmee, iagorrr, perdiDev, stevenhalim, wesley-a-leung (GaussianElimination.h), NyaanNyaan, null-lambda (linalg.rs)
- 2: cp-algorithms, ShahjalalShohag, mzhang2021, bqi343 (MatrixInv.h), the-tourist (gauss.cpp), HyunjaeLee
- 1: 12tqian (matrix.hpp), bqi343 (Xorbasis.h), maksim, p1k4-piyush, the-tourist (sparsematrix.cpp), wesley-a-leung (GaussianElimination.h), null-lambda (p_rec.rs)
- 0: anything else

## Hungarian
62 results
### Top N results
- Stonefeang
- bqi343
- joney000
- maspypy
- the-tourist
- wesley-a-leung
- wery0

### NDCG ranking
- 3: Stonefeang, ShahjalalShohag, bqi343, joney000, kactl, the-tourist, wesley-a-leung, wery0
- 2: LMeyling, 12tqian, brunomaletta, bqi343 (GeneralWeightedMatch), glapul, mzhang2021, ACM_notebook_new, tonowak, Golovanov399, ei1333
- 1: kactl dupes, test files, cuber2460, ecnerwala old_template, fishy15, oldyan, Misuki743
- 0: anything else

## Prime counting
Here is the search query:
`"count_primes" or "counting-primes" or "counting_primes" or "counting primes" or "countingprimes" or "primecnt" or "primecount" or "prime_cnt" or "lehmer" or "primefunction" or "primesum" or "min25" or "prime_count"`

84 results
### Top N results
- ShahjalalShohag
- bqi343
- KacperTopolski
- maksim1744
- maspypy primesum.hpp
- ACM_Notebook_new
- tfg50
- NyaanNyaan
- wery0

### NDCG ranking
- 3: ShahjalalShohag, maksim1744, maspypy (primesum.hpp), KacperTopolski, bqi343 (PrimeCnt.h, PrimeCntMin25.h, PrimeCntNeal.h), ACM_notebook_new, tfg50, NyaanNyaan
- 2: 12qtian, ACM_notebook_new, bqi343 (PrimeCntOld.h), maksim1744 (prime_count_slow.cpp), ShahjalalShohag (K Divisors.cpp), ftiasch, maspypy (not primesum.hpp), Golovanov399, OmeletWithoutEgg, MachiaVivias
- 1: any not-sublinear algorithms, sieves, test files
- 0: anything else

## LiChao
131 results
### Top N results
- KacperTopolski
- ahsoltan
- brunomaletta
- wesley-a-leung
- iagorrr

### NDCG ranking
- 3: KacperTopolski, ahsoltan, brunomaletta, wesley-a-leung, iagorrr
- 2: Hegdahl, ShahjalalShohag, 12qtian, bqi343, jakobkogler, Maksim1744, ACM_notebook_new, maspypy, overrule, tonowak
- 1: cp-algorithms, maspypy (Extended LiChao Tree), oldyan
- 0: anything else

## beats
33 results
### Top N results
- a
- b

# NCDG ranking
- 3: 
- 2: Hegdahl
- 1: any test/solution files
- 0: 