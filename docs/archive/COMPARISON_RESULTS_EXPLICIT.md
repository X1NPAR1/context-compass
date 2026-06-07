# Explicit Context Compass Use Experiment (Rerun)

Date: 2026-04-03
Repo: `~/test-compass/flask`
Mode: MCP enabled, hook temporarily disabled for isolation.
Method: scripted `claude -p --verbose --output-format stream-json --permission-mode bypassPermissions --model claude-sonnet-4-6`.

## Per-task Results

| Condition | Task | Read calls | MCP calls | Tokens | Timeout |
|-----------|------|------------|-----------|--------|---------|
| Explicit MCP instruction (rerun) | 1 | 5 | 2 | 164,915 | no |
| Explicit MCP instruction (rerun) | 2 | 5 | 4 | 0 | yes |
| Explicit MCP instruction (rerun) | 3 | 6 | 1 | 132,360 | no |

## Aggregate

- MCP usage tasks: `3/3`
- Avg MCP calls/task: `2.33`
- Avg read calls/task: `5.33`
- Avg tokens/task: `99,092`
- Timeouts: `1/3`

## Comparison vs prior MCP-only benchmark

Prior MCP-only (no explicit instruction) from `COMPARISON_RESULTS.md`:
- MCP usage tasks: `0/3`
- Avg MCP calls/task: `0.00`
- Avg read calls/task: `4.67`
- Avg tokens/task: `69,067`
- Timeouts: `0/3`

### Conclusion

Explicitly instructing Claude to use Context Compass does force MCP tool adoption (`0/3 -> 3/3` tasks using MCP).
In this rerun sample, read calls and token usage were not reduced; they increased, and one task timed out.
