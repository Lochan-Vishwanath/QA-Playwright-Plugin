import { McpRunner } from "./mcp-runner";
import { AgentLoop } from "./agent-loop";
import type { CLIOptions, QATestResult, LogCallback } from "./types";
import { generateQAPrompt } from "./agent";
import {
    formatOutput,
    createSuccessResult,
    createFailureResult,
    parseAgentOutput,
} from "./output";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes default

/**
 * Run the QA test with given options
 */
export async function runQATest(options: CLIOptions): Promise<QATestResult> {
    const { instruction, outputDir, baseUrl, timeout = DEFAULT_TIMEOUT_MS, verbose = false } = options;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate timestamp and create the test folder at the start
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const testDir = path.join(outputDir, `qa-test-${timestamp}`);

    // Create the test directory immediately
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    const logCallback: LogCallback | undefined = verbose ? (type, content) => {
        if (type === "prompt") {
            console.error(`[prompt] ${content}`);
        } else if (type === "output") {
            console.error(`[output] ${content}`);
        }
    } : undefined;

    // Use npx @playwright/mcp by default as requested in the plan
    // We'll use --record if needed, but for now we'll stick to basic.
    const mcp = new McpRunner("npx", ["-y", "@playwright/mcp@latest"]);
    let agentResult = "";

    try {
        await mcp.connect();
        const agent = new AgentLoop(mcp, logCallback);

        // Generate the QA prompt
        const prompt = generateQAPrompt(instruction, testDir, baseUrl);

        if (logCallback) {
            logCallback("prompt", prompt);
        }

        // Run the agent loop
        agentResult = await agent.run(prompt);

        // Parse the agent's output
        const parsed = parseAgentOutput(agentResult);

        // Use pre-created paths in the timestamped folder
        const scriptPath = path.join(testDir, "test.spec.ts");

        // Save script if content was generated
        if (parsed.scriptContent) {
            const finalScriptPath = parsed.scriptPath || scriptPath;
            fs.writeFileSync(finalScriptPath, parsed.scriptContent, "utf-8");
            parsed.scriptPath = finalScriptPath;
        }

        // Use the testStatus extracted from the agent's output (passed/failed)
        if (parsed.testStatus === "passed") {
            return createSuccessResult(
                parsed.scriptPath || scriptPath,
                "passed"
            );
        } else {
            return createFailureResult(
                parsed.errors.length > 0 ? parsed.errors : ["Test execution did not complete successfully"],
                parsed.scriptPath || scriptPath,
                "failed"
            );
        }

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return createFailureResult([`Execution error: ${errorMessage}`]);
    } finally {
        await mcp.cleanup();
    }
}

/**
 * Main export
 */
export { runQATest as run };
