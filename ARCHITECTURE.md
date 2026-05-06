# QA Playwright Plugin — Deep Architecture

## Overview

The QA Playwright Plugin is a CLI tool that converts natural language test instructions into executed browser tests and generated Playwright scripts. It has a **dual-agent architecture** — one agent for execution, one for refactoring — and uses the Model Context Protocol (MCP) as an abstraction layer over browser automation.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI (bin/qa-test.ts)                  │
│  Parses args, calls runQATest(), outputs JSON, sets exit code│
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     Runner (src/runner.ts)                   │
│  • Creates timestamped test directory                        │
│  • Resolves file paths in instructions                       │
│  • Orchestrates primary agent + optional refactor agent      │
│  • try/catch/finally with mcp.cleanup()                      │
└──────┬───────────────────────────────────┬──────────────────┘
       │                                   │
       │ (Primary Flow)                    │ (Optional: --target-repo)
┌──────▼──────────────────┐    ┌──────────▼───────────────────┐
│   Agent Loop (Primary)   │    │  Refactor Agent (Secondary)  │
│   src/agent-loop.ts      │    │  src/refactor-agent.ts       │
│                          │    │                              │
│  • Gemini 2.5 Flash      │    │  • Separate AgentLoop        │
│  • Temperature 0.1       │    │  • Filesystem MCP server     │
│  • Max 50 iterations     │    │  • Separate system prompt    │
│  • Schema sanitization   │    │  • POM integration strategy  │
│  • 5-iter nudge grace    │    │  • Lazy dynamic import       │
└──────┬──────────────────┘    └──────────┬───────────────────┘
       │                                   │
┌──────▼──────────────────┐    ┌──────────▼───────────────────┐
│   MCP Runner (Primary)   │    │   MCP Runner (Secondary)     │
│   src/mcp-runner.ts      │    │   src/mcp-runner.ts          │
│                          │    │                              │
│  • StdioClientTransport   │    │  • StdioClientTransport      │
│  • @playwright/mcp        │    │  • @modelcontextprotocol/    │
│  • Error-wrapped callTool │    │    server-filesystem         │
│  • Never throws           │    │  • Error-wrapped callTool    │
└──────┬──────────────────┘    └──────────────────────────────┘
       │
┌──────▼──────────────────┐
│   Playwright MCP Server  │
│   (external process)     │
│                          │
│  • Real browser control  │
│  • stdio JSON-RPC        │
└──────────────────────────┘
```

## Component Deep Dive

### 1. CLI Entry Point (`bin/qa-test.ts`)

The CLI is deliberately minimal — it's a **positional argument parser**, not a full CLI library:
- `process.argv` parsed manually (no commander/yargs dependency)
- Single positional arg for the instruction
- Named flags for options (`--output`, `--base-url`, etc.)
- Exit code tied to `instructions_completed` field (0 if yes, 1 if no)
- Help text generated inline

### 2. Runner (`src/runner.ts`)

The orchestrator. Key design decisions:

**File Path Resolution** (lines 19-37): Before the instruction reaches the AI, the runner scans for absolute file paths using regex `/(\/[^\s]+\.[a-zA-Z0-9]+)/g`. If a referenced file exists, its contents are read and injected into the prompt as a data block. This enables natural language references to local files: `"Login using credentials from /Users/me/creds.json"` → the agent sees the actual JSON.

**Timestamped Test Directories**: Each run creates `qa-test-{ISO-timestamp}/` inside the output directory. This is created BEFORE the agent starts, so the agent can reference it in tool calls immediately.

**Lazy Dynamic Import** (line 118): The refactor module is loaded via `const { refactorAndIntegrate } = await import("./refactor-agent")` — only if `targetRepoPath` is provided. This avoids loading the filesystem MCP code in the common case where only browser testing is needed.

**Refactor Failure Is Non-Fatal** (lines 129-135): If the refactor step crashes, the error is added to `parsed.errors` but the overall test result is still returned. The raw script is always preserved.

**Error Handling Tiers**:
| Tier | Location | Behavior |
|------|----------|----------|
| Tool-level | `mcp-runner.ts` callTool | Wraps errors as structured content, never throws |
| Loop-level | `agent-loop.ts` line 150 | Catches, logs, **re-throws** to kill session |
| Orchestration | `runner.ts` try/catch/finally | Catches everything, returns failure result, always calls `mcp.cleanup()` |

### 3. Agent Loop (`src/agent-loop.ts`)

The decision engine. This is where the AI reasoning happens.

**Initialization**:
- Reads `GEMINI_API_KEY` from environment (throws clear error if missing)
- Initializes Gemini with `gemini-2.5-flash-preview-09-2025` (pinned to specific preview version)
- Fetches MCP tool list and applies `sanitizeSchema()` before passing to Gemini

**Schema Sanitization** (lines 8-27): Gemini's function-calling API rejects `$schema` and `additionalProperties` fields that MCP tool definitions include. The sanitizer recursively strips these. Without this, the Gemini chat initialization silently fails.

**Main Loop** (lines 79-156):
```
while iteration < 50:
    send message to Gemini
    get response:
        if "=== QA TEST RESULT ===" in response → return (done)
        if has tool calls → execute, feed results back
        if pure text, iteration < 5 → nudge: "Please continue..."
        if pure text, iteration >= 5 → return text (prevent infinite loop)
        if responseText > 0 chars → log for debugging
```

Key parameters:
- **Temperature 0.1**: Deterministic behavior needed for QA
- **Max 50 iterations**: Hard safety limit
- **5-turn grace period**: Prevents premature termination when the model is thinking aloud but still intends to act

**Nudge Mechanism**: When the model returns only text (no tool calls, no final result), the system injects a soft prompt: `"Please continue with the next step or provide the final result using the required format."` This is not a system-level instruction change — it's a regular conversation turn that the model processes naturally.

### 4. MCP Runner (`src/mcp-runner.ts`)

A generic MCP client wrapper. Key design:

**Error-Wrapped callTool**: Unlike a typical SDK wrapper, `callTool()` NEVER throws. On failure, it returns `{ isError: true, content: [{ type: "text", text: errorMessage }] }`. This is critical — the Gemini agent loop needs structured content for every tool execution to continue reasoning. An uncaught exception would kill the chat history.

**Stdio Transport**: Uses `StdioClientTransport` for all MCP communication. The MCP server command is passed as constructor arguments (`npx -y @playwright/mcp@latest`), making it easy to swap servers.

**Dual-Server Pattern**: The SAME `McpRunner` class is instantiated twice with different commands:
- Primary: `npx -y @playwright/mcp@latest` → browser control
- Refactor: `npx -y @modelcontextprotocol/server-filesystem /path/to/repo` → filesystem access

Same class, different transport commands. This is a strategy pattern over stdio transport.

### 5. Agent System Prompts

**QA Engineer (`src/agent.ts`)**:
- Role: Expert QA engineer
- 3 execution phases: Parse → Execute → Generate
- 5-element locator strategy hierarchy: role → label → text → testid → CSS
- Output format contract: `=== QA TEST RESULT ===` with specific sections
- Explicit status definition: PASSED = verification succeeded, FAILED = verification failed

**Refactor Agent (`src/refactor-prompt.ts`)**:
- Role: Playwright test expert who matches existing codebase style
- 2-priority integration strategy: add to existing test file > create new file
- Philosophy: "Code should be indistinguishable from original team's work"

### 6. Output Parser (`src/output.ts`)

Instead of asking the LLM for JSON (unreliable at temperature 0.1), the parser uses regex scraping:
- `Status: PASSED|FAILED` → regex `/Status:\s*([A-Za-z]+)/i`
- `=== PLAYWRIGHT SCRIPT ===` block → multi-line regex extraction
- `Errors:` section → regex extraction
- Markdown code block cleanup → strips ```` ```typescript  ```` fences

This is battle-hardened parsing — handles the messiness of LLM output gracefully.

### 7. Types (`src/types.ts`)

The type system has four abstraction layers:

| Type | Purpose | Relationship |
|------|---------|-------------|
| `QATestResult` | Output contract | Two orthogonal axes: instructions_completed + test_status |
| `CLIOptions` | Input contract | targetRepoPath and baseUrl serve completely different flows |
| `LogCallback` | Verbosity interface | Minimal `(type, content) => void` signature |
| `TestStep` / `TestContext` | AI vocabulary | Defined for the system prompt, not runtime enforcement |

The `TestStep` and `TestContext` types are an **AI-native design pattern** — they exist to shape LLM output vocabulary, not for compiler enforcement.

### 8. Error Handling Philosophy

**Three tiers** of error handling (see table in Runner section above).

**Tool-level errors are content**: The MCP client wraps tool errors as structured MCP content responses. The agent sees `{ "isError": true, "content": "Connection refused" }` and can reason about it — maybe retry, maybe try a different approach.

**Loop-level errors are fatal**: If the Gemini API itself fails (network error, API key invalid), the agent loop catches it, logs it, and re-throws. The session cannot continue without the AI.

**Orchestrator catches everything**: The runner's outer try/catch ensures that no matter what fails — agent crash, MCP timeout, filesystem error — a valid `QATestResult` is always returned with error details.

## Data Flow

```
User Instruction (plain English)
  │
  ├─→ resolveFilePaths() — detects /absolute/paths, reads files, injects content
  │
  ├─→ generateQAPrompt() — wraps instruction in system prompt + output dir context
  │
  ├─→ AgentLoop.run(prompt)
  │     │
  │     ├─→ listTools() from MCP — get Playwright capabilities
  │     ├─→ sanitizeSchema() — strip Gemini-incompatible fields
  │     ├─→ startChat() — initialize Gemini with tools
  │     │
  │     └─→ Loop (up to 50 iterations):
  │           ├─→ sendMessage() — send prompt/tool results
  │           ├─→ response.functionCalls() — check for tool requests
  │           ├─→ callTool() — execute via MCP (error-wrapped)
  │           └─→ feed results back → continue
  │
  ├─→ parseAgentOutput() — regex extraction of status, script, errors
  │
  ├─→ save script to testDir/test.spec.ts
  │
  ├─→ (if targetRepoPath) lazy import refactor-agent
  │     └─→ refactorAndIntegrate() — second agent with filesystem MCP
  │
  └─→ return QATestResult JSON
```

## Build Architecture

```
bun build src/index.ts --outdir=dist --target=node  ← library entry
bun build bin/qa-test.ts --outdir=dist/bin --target=node  ← CLI entry

tsconfig.json:
  - noEmit: true  ← bun handles compilation
  - declaration: true  ← generate .d.ts for library consumers
  - module: "ESNext"
  - moduleResolution: "bundler"
```

Key insight: **Bun builds, targets Node**. The CLI can run on any Node.js runtime after build, not just Bun. TypeScript is only used for type-checking via `tsc --noEmit`.

## AI-Native Design Patterns

1. **Types as Prompt Vocabulary**: `TestStep` and `TestContext` interfaces exist in the type system but are never used at runtime — they shape what the AI thinks about
2. **Natural Language Output Contract**: Instead of structured JSON, the agent outputs marked sections (`=== QA TEST RESULT ===`) that are regex-parsed. This is more reliable than asking the LLM for valid JSON
3. **Soft Prompt Nudging**: When the model gets stuck in text-only mode, a conversational nudge ("Please continue...") unsticks it — no system prompt or temperature changes needed
4. **Schema Compatibility Layer**: `sanitizeSchema()` bridges the MCP protocol spec and Gemini's function-calling requirements without modifying either
5. **Dual Personas**: Two separate system prompts create two different specialized agents from the same AgentLoop infrastructure

## Files
```
qa-playwright-plugin/
├── bin/qa-test.ts              # CLI entry point, argument parser
├── src/
│   ├── index.ts                # Public API surface (library exports)
│   ├── types.ts                # Type definitions (4-layer abstraction)
│   ├── runner.ts               # Orchestrator, file resolution, refactor dispatch
│   ├── agent-loop.ts           # Gemini chat loop, schema sanitization, nudge logic
│   ├── mcp-runner.ts           # Generic MCP client with error-wrapped callTool
│   ├── agent.ts                # QA engineer system prompt + prompt generator
│   ├── refactor-agent.ts       # POM integration agent (separate MCP server)
│   ├── refactor-prompt.ts      # Refactor system prompt
│   └── output.ts               # Regex-based output parser, result formatters
├── docs/
│   └── repository-technical-explanation.md
├── package.json                # Bun build config, dual-entry, ESM module type
└── tsconfig.json               # noEmit + declaration, bundler resolution
```
