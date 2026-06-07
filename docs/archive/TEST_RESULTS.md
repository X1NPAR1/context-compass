# Context Compass Test Results (Flask + JS Repo)

Date: April 3, 2026 (America/New_York)
Tester: Codex CLI session
Scope: Full rerun of Steps 1-7 after replacing `better-sqlite3` backend usage in `src/utils/db.ts` with `sql.js`.

## Environment Info

- OS: macOS (generic test machine)
- Architecture: arm64
- Node (default shell): `v18.x`
- Node used for all test commands: `v20.x` (`npm 10.x`)
- `context-compass` path: local workspace checkout

## Summary

The hard blocker is gone: `context-compass init` now succeeds on both Flask (Python) and Express (JS), writes populated `index.db`, and reports functions/connections/sessions.

Remaining issues are mostly around parser robustness and launch/hook UX:

- `tree-sitter` still logs `Invalid argument` parse errors on specific Flask files.
- Non-interactive launch path emits Claude CLI input error.
- Hook enrichment can miss generic prompts (including the exact Step 5 prompt) even when index data exists.

---

## Step-by-Step Results

## Step 1: Environment setup

Status: **PASS (with caveat)**

- Initial `node --version`: `v18.20.8`
- Required runtime was switched successfully:

```bash
$ source ~/.nvm/nvm.sh
$ nvm install 20
v20.20.2 is already installed.
$ nvm use 20
Now using node v20.20.2 (npm v10.8.2)
```

Caveat: `nvm` is installed but not auto-loaded in shell startup.

## Step 2: Rebuild Context Compass with native deps

Status: **PASS**

Commands run:

```bash
cd "<local-path> Compass"
rm -rf node_modules
npm install
npm run build
```

Observed:

- Install/build succeeded.
- No `better-sqlite3` compile failure encountered in this rerun because DB backend now uses `sql.js` path in code.
- `tree-sitter` dependency still emits a deprecation warning from `prebuild-install`, but no build failure.

## Step 3: Link CLI globally

Status: **PASS**

```bash
$ npm link
$ which context-compass
<local-path>
```

## Step 4: Clone Flask and run init

Repo: `https://github.com/pallets/flask`

Status: **PASS (with warnings)**

Command:

```bash
$ /usr/bin/time -p context-compass init
⟡ Context Compass initializing...
  Scanning project............... 83 files (python)
  Parsing functions.............. 1102 functions, 79 modules
  Analyzing git history.......... up to 1,000 commits → 137 focused sessions
  Computing co-occurrence........ 1286 connections found
  Generating context bundles..... done

  ✓ Index ready in 49.1s
real 49.47
```

Checklist:

- Python detection: **YES** (`83 files`)
- Functions extracted: **1102**
- Connections (PMI pairs): **1286**
- Sessions from git history: **137**
- Init duration: **49.47s real**
- Errors/warnings: **YES** (`tree-sitter` parse warnings in `error.log`, see below)
- `.context-compass/index.db`: **YES**
- DB size >100KB: **YES** (`6.2M`)

Warnings recorded in `.context-compass/error.log` (init still succeeded):

- `parse_file:src/flask/app.py` → `Invalid argument`
- `parse_file:src/flask/cli.py` → `Invalid argument`
- `parse_file:src/flask/sansio/app.py` → `Invalid argument`
- `parse_file:tests/test_basic.py` → `Invalid argument`

## Step 5: Test launch + hook

Status: **PARTIAL PASS / PARTIAL FAIL**

### Launch behavior

- Non-interactive run:

```bash
$ context-compass
⟡ Context Compass
  ✓ Index loaded (1102 functions, 1286 connections)
  ✓ 4 files changed — updating...
  → Launching Claude Code
Error: Input must be provided either through stdin or as a prompt argument when using --print
```

- Interactive TTY run did open Claude Code UI (loading screen + REPL visible).

### Prompt test (`"explain how Flask's routing system works"`)

Result: **FAIL for enrichment on this exact prompt**

- Hook output for this prompt was:

```json
{"continue":true}
```

- No `additionalContext` payload.
- `.context-compass/current-context.md` was created as `0B`.

### Prompt enrichment stats

Result: **PASS** (prompt counting works)

After hook invocations, `.context-compass/stats.json` incremented prompt counters and token savings.

### Context quality check

- For the exact Step 5 prompt: **No bundle context attached**.
- For a targeted prompt (`"stream_with_context"`): hook returned enriched context with specific symbols and tunnel relations (for example: `stream_with_context`, `TestStreaming.index()`, `relation=CALLS`, `relation=TEST`, PMI scores).

Interpretation: enrichment pipeline works, but retrieval/ranking misses common generic prompts.

## Step 6: Second repo (JavaScript)

Repo: `https://github.com/expressjs/express`

Status: **PASS**

Command:

```bash
$ /usr/bin/time -p context-compass init
⟡ Context Compass initializing...
  Scanning project............... 141 files (javascript)
  Parsing functions.............. 277 functions, 141 modules
  Analyzing git history.......... up to 1,000 commits → 113 focused sessions
  Computing co-occurrence........ 240 connections found
  Generating context bundles..... done

  ✓ Index ready in 45.3s
real 45.47
```

Checklist:

- JS detection: **YES** (`141 files`)
- Functions extracted: **277**
- Connections (PMI pairs): **240**
- Sessions from git history: **113**
- Init duration: **45.47s real**
- Errors/warnings: **NO `error.log` created**
- `.context-compass/index.db`: **YES**
- DB size >100KB: **YES** (`1.0M`)

## Step 7: Edge cases

### 7.1 `context-compass init` in directory with no git history

Status: **PASS**

Dir: `~/test-compass/no-git-dir` with one `sample.js`, no `.git`

```bash
Scanning project............... 1 files (javascript)
Parsing functions.............. 0 functions, 1 modules
Analyzing git history.......... up to 1,000 commits → 0 focused sessions
Computing co-occurrence........ 0 connections found
✓ Index ready in 0.0s
```

### 7.2 `context-compass init` in empty directory

Status: **PASS**

Dir: `~/test-compass/empty-dir`

```bash
Scanning project............... 0 files (none)
Parsing functions.............. 0 functions, 0 modules
Analyzing git history.......... up to 1,000 commits → 0 focused sessions
Computing co-occurrence........ 0 connections found
✓ Index ready in 0.0s
```

### 7.3 `context-compass` launch in directory that has not been initialized

Status: **PASS**

Dir: `~/test-compass/uninitialized-dir`

```bash
⟡ Context Compass
  Index not found. Run 'context-compass init' first.
```

### 7.4 `context-compass stats` before any sessions

Status: **PASS**

Checked in `~/test-compass/express` before any prompt submissions:

```bash
⟡ Context Compass Stats

  Today:      0 prompts enriched · ~0 tokens saved
  This week:  0 prompts · ~0 tokens saved

  Index: 277 functions · 240 connections · last updated just now
  Top domains used: none
```

---

## Key Terminal Output (Evidence)

### Flask init success metrics

```text
Parsing functions.............. 1102 functions, 79 modules
Analyzing git history.......... up to 1,000 commits → 137 focused sessions
Computing co-occurrence........ 1286 connections found
✓ Index ready in 49.1s
```

### Express init success metrics

```text
Parsing functions.............. 277 functions, 141 modules
Analyzing git history.......... up to 1,000 commits → 113 focused sessions
Computing co-occurrence........ 240 connections found
✓ Index ready in 45.3s
```

### Remaining parse warning example

```text
[parse_file:src/flask/app.py] Invalid argument
Error: Invalid argument
    at Parser.parse (.../node_modules/tree-sitter/index.js:361:13)
```

### Launch issue in non-interactive mode

```text
→ Launching Claude Code
Error: Input must be provided either through stdin or as a prompt argument when using --print
```

---

## Blockers (must fix before a self-test week)

1. **Generic prompt enrichment miss:** the exact test prompt (`"explain how Flask's routing system works"`) produced no additional context (`{"continue":true}` only). This undermines day-to-day value unless prompt phrasing is very specific.
2. **Parser reliability warnings on Flask:** repeated `tree-sitter` `Invalid argument` errors on core files mean indexed coverage is incomplete/fragile.
3. **Launch behavior differs by execution mode:** non-interactive launch surfaces Claude input-mode error. This makes scripted/self-test flows noisy and ambiguous.

## Nice to Have

1. Add explicit inline warning counter in `init` output (for parse failures) instead of requiring `error.log` inspection.
2. Improve bundle selection to prioritize symbols that actually have bundles (functions/methods) before class-only matches.
3. Provide a diagnostic command (or `stats` section) showing enrichment hit-rate: prompts processed vs prompts with non-empty `additionalContext`.
