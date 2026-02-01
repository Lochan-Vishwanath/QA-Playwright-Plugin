import { McpRunner } from "./mcp-runner";
import { AgentLoop } from "./agent-loop";
import * as fs from "fs";
import * as path from "path";
import { REFACTOR_SYSTEM_PROMPT } from "./refactor-prompt.ts";

export interface RefactorOptions {
    rawScript: string;
    targetRepoPath: string;
    outputDir: string;
    verbose?: boolean;
}

export async function refactorAndIntegrate(options: RefactorOptions): Promise<string> {
    const { rawScript, targetRepoPath, outputDir, verbose = false } = options;

    if (!fs.existsSync(targetRepoPath)) {
        throw new Error(`Target repository path does not exist: ${targetRepoPath}`);
    }

    const logCallback = verbose ? (type: string, content: string) => {
        console.error(`[refactor-${type}] ${content}`);
    } : undefined;

    // Use filesystem MCP for the target repository
    const mcp = new McpRunner("npx", ["-y", "@modelcontextprotocol/server-filesystem", targetRepoPath]);

    try {
        await mcp.connect();
        const agent = new AgentLoop(mcp, logCallback);

        const prompt = `
# Task: Refactor and Integrate Playwright Test

## Raw Script to Refactor:
\`\`\`typescript
${rawScript}
\`\`\`

## Target Repository:
${targetRepoPath}

## Instructions:
1. Explore the target repository to understand its Page Object Model (POM) and testing conventions.
2. Identify existing Page Objects that can be reused or extended. Look in "pages/" directory.
3. Decide whether to add the test case to an existing test file (look in "tests/" directory) or create a new one. Priority is to add to an existing file if it fits.
4. Refactor the raw script into a professional POM structure matching the repo's style.
5. Apply the changes to the target repository using the available tools.
6. Verify the changes (e.g., check for type errors if tools allow, or just ensure the output is clean).

Please start by listing the directories in the target repository to get your bearings.
`;

        const result = await agent.run(`${REFACTOR_SYSTEM_PROMPT}\n\n${prompt}`);
        return result;

    } finally {
        await mcp.cleanup();
    }
}
