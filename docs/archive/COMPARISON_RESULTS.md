# Context Compass Comparison Results

Date: 2026-04-03

Repo: `~/test-compass/flask`

Method: scripted `claude -p --verbose --output-format stream-json --permission-mode bypassPermissions --model claude-sonnet-4-6` across 4 conditions x 3 tasks.

Interactive sanity: MCP connectivity verified with `claude mcp list` (`context-compass ... Connected`) and tool availability observed in stream init (`mcp__context-compass__*` tools present).

| Condition | Task | Read calls | Tokens | Quality | Notes |
|-----------|------|------------|--------|---------|-------|
| A: Raw | 1 | 5 | 107,144 | 5/5 | MCP calls=0; Referenced CC=no; TTFM=4217ms; Cost=$0.0681; timeout=no |
| A: Raw | 2 | 2 | 0 | 2/5 | MCP calls=0; Referenced CC=no; TTFM=2821ms; Cost=n/a; timeout=yes |
| A: Raw | 3 | 7 | 129,051 | 2/5 | MCP calls=0; Referenced CC=no; TTFM=3890ms; Cost=$0.1047; timeout=no |
| B: Hook | 1 | 4 | 93,003 | 5/5 | MCP calls=0; Referenced CC=no; TTFM=4718ms; Cost=$0.0751; timeout=no |
| B: Hook | 2 | 1 | 0 | 1/5 | MCP calls=0; Referenced CC=no; TTFM=4658ms; Cost=n/a; timeout=yes |
| B: Hook | 3 | 1 | 72,660 | 2/5 | MCP calls=0; Referenced CC=no; TTFM=4545ms; Cost=$0.0903; timeout=no |
| C: MCP | 1 | 5 | 104,689 | 5/5 | MCP calls=0; Referenced CC=no; TTFM=3736ms; Cost=$0.0802; timeout=no |
| C: MCP | 2 | 4 | 0 | 2/5 | MCP calls=0; Referenced CC=no; TTFM=3238ms; Cost=n/a; timeout=yes |
| C: MCP | 3 | 5 | 102,513 | 3/5 | MCP calls=0; Referenced CC=no; TTFM=4541ms; Cost=$0.0713; timeout=no |
| D: Both | 1 | 4 | 93,164 | 5/5 | MCP calls=0; Referenced CC=no; TTFM=4996ms; Cost=$0.0745; timeout=no |
| D: Both | 2 | 0 | 0 | 1/5 | MCP calls=0; Referenced CC=no; TTFM=1398ms; Cost=$0.0000; timeout=no |
| D: Both | 3 | 0 | 0 | 1/5 | MCP calls=0; Referenced CC=no; TTFM=1484ms; Cost=$0.0000; timeout=no |

## Summary

- Avg Read calls: Raw=4.7, Hook=2.0, MCP=4.7, Both=1.3.
- Avg Tokens: Raw=78732, MCP=69067, Both=31055.
- MCP read-call reduction vs Raw: 0.0%.
- Hook+MCP read-call reduction vs Raw: 71.4%.
- MCP token delta vs Raw: 12.3%.
- Hook+MCP token delta vs Raw: 60.6%.
- MCP tool use in MCP-only runs: 0/3 tasks.
- MCP tool use in Hook+MCP runs: 0/3 tasks.

## MCP Tool Usage Detail

