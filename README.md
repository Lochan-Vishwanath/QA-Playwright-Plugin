# QA Playwright Plugin

AI-powered Playwright QA testing from natural language instructions.

## About

The QA Playwright Plugin is an intelligent testing CLI tool that transforms natural language test instructions into executable Playwright browser tests. Tell it what to test in plain English — "check if the login page shows an error for invalid email" — and it executes the test in a real browser, verifies the results, and generates a production-ready Playwright test script.

Built on the **Model Context Protocol (MCP)**, it bridges AI reasoning (Google Gemini) with browser automation (Playwright) through a standardized protocol layer. This means the same agent architecture can swap browser drivers without changing the AI or orchestration code.

### Core Flow

```
User: "Test login with invalid email"
  → CLI parses instruction
  → Gemini agent plans test steps
  → MCP client executes actions in real browser
  → Agent verifies outcomes
  → Generates Playwright .spec.ts file
  → (Optional) Smart refactor integrates into existing POM test repo
```

## What Makes This Unique

### 1. Dual-Agent Architecture
Not just one AI agent — **two specialized agents** work back-to-back:
- **Runner Agent**: Executes tests in a real browser via Playwright MCP. Has a built-in element-finding strategy hierarchy (role → label → text → testid → CSS) for robust locator selection
- **Refactor Agent**: Takes the generated raw test script and intelligently integrates it into an existing Page Object Model (POM) repository — adding to existing test files or creating new ones that match the project's conventions

### 2. MCP as a Protocol Layer
Rather than hardcoding Playwright, the tool uses the Model Context Protocol as an abstraction layer. The same `AgentLoop` and `McpRunner` classes work with any MCP-compliant server — Playwright for the browser, Filesystem for smart refactoring. This is a **strategy pattern over stdio transport** — plug in different MCP servers without touching the agent code.

### 3. Schema Sanitization for LLM Compatibility
Gemini's function-calling API rejects `$schema` and `additionalProperties` fields that the MCP protocol includes. The agent loop has a recursive schema sanitizer that strips these before passing tool definitions to Gemini. This is the kind of LLM-vendor-specific compatibility work that most tools skip — and without it, the entire pipeline silently fails.

### 4. Orthogonal Success/Failure Axes
The output has two independent result dimensions:
- **`instructions_completed`**: Did the agent finish executing? (yes/no)
- **`test_status`**: Did the verification pass? (passed/failed)

This means a test can gracefully fail with useful output — the script is still generated and saved, and you know exactly what went wrong. The refactor step's failure is also non-fatal — the raw test script is always preserved.

### 5. File Path Resolution in Natural Language
You can reference local files in your test instructions: `"Login using credentials from /Users/me/creds.json"`. The runner detects absolute file paths in your instruction, reads the file contents, and injects them into the AI prompt. The agent sees the actual data — no copy-pasting needed.

## Technical Highlights

- **Built with Bun + TypeScript** — targets Node.js runtime for portability
- **Gemini 2.5 Flash** with temperature 0.1 for deterministic QA behavior
- **Up to 50 agent loop iterations** with a 5-turn grace period before auto-termination (prevents the model from getting stuck thinking aloud)
- **Regex-based output parsing** — extracts structured results from natural language LLM output (more reliable than asking for JSON)
- **Lazy dynamic imports** — the refactor module is only loaded when actually needed, saving startup time
- **Timestamped test directories** — each run creates a unique `qa-test-{timestamp}` folder
- **Generates production-ready Playwright scripts** with `getByRole`, `getByLabel` locators (not brittle CSS)

## How to Run

### Prerequisites
- **Bun** (runtime + build tool)
- **Google Gemini API key** (get from [aistudio.google.com](https://aistudio.google.com))

### Setup
```bash
# Clone and install
cd qa-playwright-plugin
bun install
bun run build

# Set API key
export GEMINI_API_KEY="your_key_here"
```

### Usage
```bash
# Basic test
bun run dev -- "Navigate to example.com and verify the heading text"

# With base URL (tests against staging)
bun run dev -- "Test login flow" --base-url https://staging.myapp.com

# With smart refactor (integrate into existing POM repo)
bun run dev -- "Test checkout flow" -r /path/to/playwright-project

# Verbose mode
bun run dev -- "Test search functionality" --log

# Custom output directory
bun run dev -- "Verify homepage links" -o /tmp/my-tests

# Custom timeout (10 minutes)
bun run dev -- "Complex multi-step test" -t 600000
```

### CLI Options
| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--output` | `-o` | Output directory | `~/qa-playwright-results` |
| `--base-url` | `-b` | Base URL for relative paths | none |
| `--target-repo` | `-r` | Path to repo for Smart Refactor | none |
| `--timeout` | `-t` | Timeout in ms | 300000 (5 min) |
| `--log` | `-l` | Verbose logging | false |
| `--help` | `-h` | Show help | — |

### Output
Each test run produces:
- **`test.spec.ts`** — Executable Playwright test file
- **JSON result** — Structured pass/fail status with errors and script path
- **Artifacts directory** — Timestamped folder with all generated files

### Tech Stack
| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Language | TypeScript |
| AI Model | Google Gemini 2.5 Flash |
| Protocol | Model Context Protocol (MCP) |
| Browser | Playwright (via MCP) |
| Build | `bun build --target=node` |

---

**GitHub**: [github.com/placeholder/qa-playwright-plugin](https://github.com/placeholder/qa-playwright-plugin)  
**License**: PolyForm Noncommercial 1.0.0
