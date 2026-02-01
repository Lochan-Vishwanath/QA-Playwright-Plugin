# QA Playwright Plugin: Technical Explanation

## Overview
The **QA Playwright Plugin** is an AI-powered quality assurance tool designed to bridge the gap between natural language requirements and automated Playwright test scripts. It leverages Large Language Models (LLMs) and the Model Context Protocol (MCP) to execute browser-based tests dynamically and then synthesize those actions into production-ready code.

The repository follows a modular TypeScript architecture, using [Bun](https://bun.sh/) as its primary runtime and build tool.

---

## What This Repo Does
This repository provides a CLI tool and a library that:
1.  **Parses Natural Language**: Takes user instructions (e.g., "Login as admin and check dashboard") and breaks them down into executable test steps.
2.  **Executes Live Tests**: Uses a browser (via Playwright) to perform the actions in real-time, verifying outcomes at each step.
3.  **Generates Scripts**: Produces a full `@playwright/test` specification file based on the successful execution.
4.  **Smart Refactoring**: Automatically integrates the generated "raw" script into an existing codebase, adhering to its local Page Object Model (POM) patterns and directory structures.

---

## Technical Architecture & Core Components

### 1. The Brain: Agentic Loop (`src/agent-loop.ts`)
The core of the plugin is an **Agent Loop** powered by Google's **Gemini 2.5 Flash** model. Unlike a simple prompt-response system, this agent maintains a conversation history and interacts with external tools via MCP.
-   **Tool Invocation**: It detects when the LLM wants to call a "tool" (like clicking a button or navigating to a URL) and executes that tool using the `McpRunner`.
-   **Fallback Strategies**: The system prompt (defined in `src/agent.ts`) instructs the agent to retry actions using alternative selectors (ARIA roles, labels, text) if initial attempts fail, making the automation highly resilient.

### 2. Communication Layer: MCP Runner (`src/mcp-runner.ts`)
The plugin uses the **Model Context Protocol (MCP)** to interact with the environment.
-   **Browser Control**: It spawns an MCP server (specifically `@playwright/mcp`) to control a Chromium instance.
-   **Filesystem Access**: For the refactoring phase, it uses the `@modelcontextprotocol/server-filesystem` to read and write to the user's target repository.
-   **Standardization**: By using MCP, the agent can easily switch or add new capabilities without changing the core logic.

### 3. Orchestration: Runner (`src/runner.ts`)
The `runner.ts` module acts as the conductor:
-   It ensures output directories exist.
-   Starts the Playwright MCP server.
-   Initializes the `AgentLoop`.
-   Saves the final Playwright script.
-   Triggers the `RefactorAgent` if a target repository is specified.

### 4. Smart Refactor: Refactor Agent (`src/refactor-agent.ts`)
This is a specialized implementation of the agent loop designed for code integration.
-   **Context Awareness**: It explores the target repository's `pages/` and `tests/` directories to understand local conventions.
-   **Refactoring**: It transforms the raw "all-in-one" Playwright script into modular code that uses existing Page Objects or creates new ones if necessary.
-   **Integration**: It chooses whether to append the test to an existing file or create a new specification.

---

## How It Achieves Its Goals (The Technical Method)

### Step-by-Step Workflow:

1.  **Initialization**: 
    The CLI (`bin/qa-test.ts`) parses user input and env variables (like `GEMINI_API_KEY`). It calls `runQATest` in the `runner.ts`.

2.  **Instruction Parsing**: 
    The `AgentLoop` sends the user's instruction to the Gemini model with a comprehensive system prompt (`src/agent.ts`). This prompt defines the "QA Engineer" persona and provides strict guidelines on verification and script generation.

3.  **The Execution Loop**:
    -   The Model suggests a tool call (e.g., `playwright_navigate({ url: "..." })`).
    -   `McpRunner` executes this against the running Playwright MCP server.
    -   The result (success/fail/dom-snapshot) is fed back to the Model.
    -   The Model verifies the outcome and proceeds to the next step.

4.  **Script Synthesis**:
    Once all steps are completed (and verified), the Model generates a string containing the full TypeScript code for a Playwright test. The `output.ts` module uses regex to extract this script and the final status from the Model's final response.

5.  **Smart Integration (Optional)**:
    If the `--target-repo` flag is provided:
    -   A new `AgentLoop` is started with a `REFACTOR_SYSTEM_PROMPT`.
    -   This agent "walks" the filesystem of the target repo.
    -   It uses its internal knowledge and the repo's context to refactor the generated code.
    -   It applies the final changes directly to the target repo.

---

## Key Technologies
-   **Runtime**: Bun
-   **AI**: Google Generative AI (Gemini 2.5 Flash)
-   **Automation**: Playwright (via @playwright/mcp)
-   **Protocol**: Model Context Protocol (MCP) SDK
-   **Language**: TypeScript (ESM)

---

## Directory Summary (Explored)
-   `src/agent.ts`: Personas and prompts for test execution.
-   `src/agent-loop.ts`: The autonomous execution engine for Gemini.
-   `src/mcp-runner.ts`: Technical bridge to MCP servers.
-   `src/runner.ts`: Main entry point for the testing logic.
-   `src/refactor-agent.ts`: Logic for POM-based code refactoring.
-   `src/output.ts`: Data extraction and result formatting.
-   `src/types.ts`: Interface definitions.
-   `bin/qa-test.ts`: CLI argument parsing and execution flow.
