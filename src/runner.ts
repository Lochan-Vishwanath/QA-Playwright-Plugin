import { McpRunner } from "./mcp-runner";
import { AgentLoop } from "./agent-loop";
import type { CLIOptions, QATestResult, LogCallback } from "./types";
import { generateQAPrompt } from "./agent";
import {
    formatOutput,
    createSuccessResult,
    createFailureResult,
    parseAgentOutput,
    extractCodeBlock,
} from "./output";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { POMIndexer } from "./features/smart-refactor/indexer";
import { ContextMatcher } from "./features/smart-refactor/matcher";
import { generateRefactorPrompt } from "./features/smart-refactor/prompt";

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

    const logCallback: LogCallback | undefined = verbose ? (event) => {
        if (event.type === "prompt") {
            console.error(`[prompt] ${event.content}`);
        } else if (event.type === "output") {
            console.error(`[output] ${event.content}`);
        } else if (event.type === "tools") {
            console.error(`[tools] Available: ${event.tools?.map(t => t.name).join(", ")}`);
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
            logCallback({ type: "prompt", content: prompt });
        }

        // Run the agent loop
        agentResult = await agent.run(prompt);

        // Parse the agent's output
        const parsed = parseAgentOutput(agentResult);

        // Use pre-created paths in the timestamped folder
        const scriptPath = path.join(testDir, "test.spec.ts");

        // Save script if content was generated
        if (parsed.scriptContent) {
            let contentToSave = parsed.scriptContent;

            // --- SMART REFACTOR ---
            try {
                if (verbose) console.error("[Smart Refactor] Scanning for relevant Page Objects...");

                // 1. Index the project (current working directory)
                const indexer = new POMIndexer();
                const index = await indexer.index(process.cwd());

                // 2. Match the generated code to the index
                const matcher = new ContextMatcher();
                const context = matcher.match(contentToSave, index);

                if (context.relevantPages.length > 0) {
                    if (verbose) {
                        console.error(`[Smart Refactor] Found ${context.relevantPages.length} relevant Page Objects.`);
                        context.relevantPages.forEach(p => console.error(`  - ${p.className} (${p.filePath})`));
                    }

                    // 3. Generate the Refactor Prompt
                    const refactorPrompt = generateRefactorPrompt(contentToSave, context);

                    // 4. Ask Gemini to refactor
                    if (process.env.GEMINI_API_KEY) {
                        if (verbose) console.error("[Smart Refactor] Refactoring code with AI...");

                        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                        // Use a fast model for this single-shot task
                        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

                        const result = await model.generateContent(refactorPrompt);
                        const response = result.response;
                        const refactoredText = response.text();

                        // Extract the code from the response
                        const refactoredCode = extractCodeBlock(refactoredText);

                        if (refactoredCode && refactoredCode.length > 50) {
                            contentToSave = refactoredCode;
                            if (verbose) console.error("[Smart Refactor] ✅ Code refactored successfully.");
                        } else {
                            if (verbose) console.error("[Smart Refactor] ⚠️  Refactoring returned empty or invalid code. Using original.");
                        }
                    }
                } else {
                    if (verbose) console.error("[Smart Refactor] No relevant Page Objects found. Skipping refactor.");
                }
            } catch (err) {
                console.error("[Smart Refactor] ❌ Failed:", err);
                // Fallback to original content
            }
            // ----------------------

            const finalScriptPath = parsed.scriptPath || scriptPath;
            fs.writeFileSync(finalScriptPath, contentToSave, "utf-8");
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
