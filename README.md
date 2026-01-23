# QA Playwright Plugin

AI-powered Playwright QA testing from natural language instructions.

## Overview

This plugin allows you to run browser tests by simply describing what you want to test in plain English. It uses a standalone AI agent loop combined with Playwright MCP to:

1. Parse your test instructions into executable steps
2. Drive a browser using AI + Playwright
3. Generate reusable Playwright test scripts
4. Output structured JSON results

## Installation

```bash
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

### Prerequisites

You need a **Gemini API Key** to power the AI agent.

```bash
export GEMINI_API_KEY=your_api_key_here
```

### Basic Usage

```bash
# Run with bun (development)
bun run dev "Navigate to example.com and verify the heading says 'Example Domain'"

# After building
./dist/bin/qa-test.js "Test instruction here"

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
  -l, --log            Enable verbose logging of agent progress to stderr
  -h, --help           Show help
```

## How It Works: The Standalone Agentic Loop

This tool operates through an internal "Agentic Loop":

### 1. The Architect (System Persona)
*   Defines the "QA Engineer" persona and strict fallback strategies (e.g., trying Role > Label > Text).
*   Orchestrates the session and manages inputs.

### 2. The Agent Loop (The Intelligence & Dispatcher)
*   **Gemini AI**: Powers the reasoning engine that decides which actions to take.
*   **Automatic Feedback Loop**: When a browser action fails (e.g., "element not found"), the plugin automatically feeds that error back to the AI. This allows the AI to immediately rethink its next move based on real-time browser state.
*   **Tool Gateway**: Directly communicates with **Playwright MCP** via JSON-RPC to execute browser commands.

### 3. Verification & Script Composition
*   After every action, the AI verifies the result before moving to the next step.
*   Once finished, it compiles successful actions into a clean, production-ready Playwright script.

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
    │   QA Playwright Plugin           │
    │   (System Persona & Strategy)    │
    └─────────┬────────────────────────┘
              │ 3. Agent Loop (Gemini)
    ┌─────────▼────────────────────────┐        ┌──────────────────┐
    │      Internal Dispatcher         │◄───────┤ Feedack Loop     │
    │   (Intelligence & Tool Calls)    │        │ (Errors/Results) │
    └─────────┬────────────────────────┘        └────────▲─────────┘
              │ 4. Tool Execution                        │
    ┌─────────▼────────────────────────┐        ┌────────┴─────────┐
    │      Playwright MCP              ├────────►  Test Reports    │
    │    (Browser Automation)          │        │     (JSON)       │
    └─────────┬───────────▲────────────┘        └──────────────────┘
              │           │                              │
              │ Actions   │ Selectors                    │ 5. Save
    ┌─────────▼───────────┴────────────┐        ┌────────┴─────────┐
    │       Real Browser               │        │  Local Artifacts │
    │   (Chrome/Firefox/Webkit)        │        │ (.spec.ts files) │
    └──────────────────────────────────┘        └──────────────────┘
```

## License

PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE) for details.
