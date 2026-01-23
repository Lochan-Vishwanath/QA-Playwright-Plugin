# QA Playwright Plugin

AI-powered Playwright QA testing from natural language instructions.

## Overview

This plugin allows you to run browser tests by simply describing what you want to test in plain English. It uses OpenCode's AI capabilities combined with Playwright MCP to:

1. Parse your test instructions into executable steps
2. Drive a browser using AI + Playwright
3. Generate reusable Playwright test scripts
4. Output structured JSON results

## Installation

```bash
# Install OpenCode globally
npm install -g opencode-ai

# Install Playwright MCP globally
npm install -g @playwright/mcp

# Clone or copy the plugin
cd qa-playwright-plugin

# Install dependencies
bun install

# Build
bun run build

# Link globally (optional)
npm link
```

## Usage

### Basic Usage

```bash
# Run with bun (development)
bun run dev "Navigate to example.com and verify the heading says 'Example Domain'"

# After building
./dist/bin/qa-test.js "Test instruction here"

# Windows (Command Prompt)
node dist\bin\qa-test.js "Test instruction here"

# After npm link
qa-test "Test instruction here"
```

### CLI Options

```bash
qa-test "<instruction>" [options]

Options:
  -o, --output <dir>   Output directory for artifacts (default: ~/qa-playwright-results)
  -b, --base-url <url> Base URL for relative paths
  -t, --timeout <ms>   Timeout in milliseconds (default: 300000)
  -h, --help           Show help
```

**Note for Windows**: Use backslashes for paths or escape them:
```cmd
node dist\bin\qa-test.js "Test instruction" --output C:\Users\<username>\qa-results
```

### Examples

```bash
# Simple navigation test
qa-test "Go to example.com and verify the title contains 'Example'"

# Login test with base URL
qa-test "Navigate to /login, enter test@example.com in email, click Submit" \
  --base-url https://staging.myapp.com

# Complex flow with custom output (Linux/macOS)
qa-test "Test checkout: add item to cart, go to checkout, fill shipping form" \
  --output ~/qa-results \
  --timeout 600000

# Windows Command Prompt
node dist\bin\qa-test.js "Test checkout" --output C:\Users\<username>\qa-results --timeout 600000
```

## Output Format

The plugin outputs JSON to stdout:

### Success

```json
{
  "instructions_completed": "yes",
  "link_to_playwrightscript": "/path/to/qa-test-2026-01-21.spec.ts"
}
```

### Failure

```json
{
  "instructions_completed": "no",
  "link_to_playwrightscript": "",
  "error": [
    "Could not find element: 'Submit Button'",
    "Retry attempts exhausted"
  ]
}
```

## Requirements

1. **OpenCode** - Must be installed and configured with an API key
2. **Playwright MCP** - Install globally or let the plugin use npx:
   ```bash
   npm install -g @playwright/mcp
   ```

## Configuration

### Step 1: Configure OpenCode with Playwright MCP

Add the Playwright MCP server to your OpenCode configuration file.

**Location**: `~/.config/opencode/opencode.json` (Linux/macOS) or `%USERPROFILE%\.config\opencode\opencode.json` (Windows)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/grok-code",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": [
        "npx",
        "@playwright/mcp@latest"
      ]
    }
  },
  "permission": {
    "external_directory": "allow",
    "read": "allow",
    "edit": "allow",
    "bash": "allow",
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "task": "allow",
    "webfetch": "allow",
    "websearch": "allow",
    "codesearch": "allow"
  }
}
```

> **Important**: The MCP config requires:
> - `"type": "local"` for local command execution
> - `"command"` as an **array** of strings (not a single string)

Update to this in ~/.config/opencode/opencode.json

### Step 2: Verify Configuration

```bash
# Check your config (Linux/macOS)
cat ~/.config/opencode/opencode.json

# Check your config (Windows)
type %USERPROFILE%\.config\opencode\opencode.json

# Test opencode starts correctly
opencode --version
```

### Windows Setup

On Windows, the OpenCode executable needs to be accessible. The plugin attempts to auto-detect its location, but if you encounter `ENOENT` errors:

#### Option 1: Set OPENCODE_BIN_PATH Environment Variable

```powershell
# In PowerShell (run as Administrator)
[Environment]::SetEnvironmentVariable("OPENCODE_BIN_PATH", "$env:USERPROFILE\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe", "User")

# Restart your terminal and verify
echo $env:OPENCODE_BIN_PATH
```

#### Option 2: Copy opencode.exe to npm Directory

```cmd
# In Command Prompt as Administrator
copy "%USERPROFILE%\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe" "%USERPROFILE%\AppData\Roaming\npm\opencode.exe"
```

#### Option 3: Add to System PATH

```powershell
# In PowerShell (run as Administrator)
$path = "$env:USERPROFILE\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin"
[Environment]::SetEnvironmentVariable("PATH", "$path;$env:PATH", "User")

# Restart your terminal
```

#### Windows Troubleshooting

If you see `ENOENT: no such file or directory, uv_spawn 'opencode'`:

1. Verify OpenCode is installed:
   ```cmd
   where opencode
   ```

2. Check if the binary exists:
   ```cmd
   dir "%USERPROFILE%\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe"
   ```

3. Try running directly:
   ```cmd
   "%USERPROFILE%\AppData\Roaming\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64\bin\opencode.exe" --version
   ```

## How It Works: The Synergy

This tool operates through a collaborative "Agentic Loop" between three core layers:

### 1. The Plugin (The Architect)
*   **Strategy Definition**: It defines the "QA Engineer" persona and the strict fallback strategies (e.g., trying Role > Label > Text) that guide the AI.
*   **Mission Control**: It orchestrates the session, manages CLI inputs, and handles the local filesystem to save generated scripts.
*   **Artifact Extraction**: It parses the raw conversation from the AI to extract structured data and reproducible test code.

### 2. OpenCode (The Platform & Dispatcher)
*   **Agent Infrastructure**: It hosts the AI session and provides the secure environment for tool execution.
*   **Automatic Feedback Loop**: When a browser action fails (e.g., "element not found"), OpenCode automatically feeds that error back to the AI. This "auto-submit" behavior allows the AI to immediately rethink its next move based on real-time browser state.
*   **Tool Gateway**: It translates the AI's intent into actual Playwright commands via MCP (Model Context Protocol).

### 3. The AI Agent (The Intelligent Worker)
*   **Iterative Problem Solving**: The AI doesn't just "guess"; it follows the strategies provided by the plugin. If one locator fails, it autonomously decides which fallback to try next based on the DOM context it receives.
*   **Verification**: After every action, the AI verifies the result (e.g., checking if a URL changed or a message appeared) before moving to the next step.
*   **Script Composition**: As it works, it compiles its successful actions into a clean, production-ready Playwright script.

## Generated Scripts

The plugin generates production-ready Playwright test code:

```typescript
import { test, expect } from '@playwright/test';

test('QA Test: Login flow', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Welcome')).toBeVisible();
});
```

You can run generated scripts with:

```bash
npx playwright test /path/to/generated.spec.ts
```

## Architecture

```text
         [ 1. Input ]
              │
    ┌─────────▼────────────────────────┐
    │     CLI (qa-test)                │
    └─────────┬────────────────────────┘
              │ 2. Setup & Rules
    ┌─────────▼────────────────────────┐
    │   QA Playwright Plugin           │◄────────────────┐
    │   (System Persona & Strategy)    │                 │
    └─────────┬────────────────────────┘                 │
              │ 3. Dispatch                              │ 6. Extract
    ┌─────────▼────────────────────────┐                 │    Results
    │      OpenCode SDK                │                 │
    │   (Agentic Loop Platform)        │                 │
    └─────────┬───────────▲────────────┘                 │
              │ 4. Prompt │ 5. Feedback                  │
    ┌─────────▼───────────┴────────────┐        ┌────────┴─────────┐
    │        AI Agent Logic            │        │  Local Artifacts │
    │    (Intelligence & Decider)      │        │ (.spec.ts files) │
    └─────────┬───────────▲────────────┘        └────────▲─────────┘
              │           │                              │
              │ Tools     │ Results                      │ 7. Save
    ┌─────────▼───────────┴────────────┐        ┌────────┴─────────┐
    │      Playwright MCP              ├────────►  Test Reports    │
    │    (Browser Automation)          │        │     (JSON)       │
    └─────────┬───────────▲────────────┘        └──────────────────┘
              │           │
              │ Actions   │ Selectors
    ┌─────────▼───────────┴────────────┐
    │       Real Browser               │
    │   (Chrome/Firefox/Webkit)        │
    └──────────────────────────────────┘
```

The system is designed as a **feedback-driven loop**. The **Plugin** provides the rules, **OpenCode** provides the infrastructure, and the **AI** provides the intelligence to navigate complex web UIs iteratively until the mission is accomplished.

## License

PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE) for details.
