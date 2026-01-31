/**
 * Refactoring Agent
 * 
 * Combines the raw code generation agent with the refactoring pipeline
 * to provide end-to-end functionality.
 */

import { McpRunner } from "../mcp-runner";
import { AgentLoop } from "../agent-loop";
import { generateQAPrompt } from "../agent";
import { parseAgentOutput } from "../output";
import { refactorPipeline } from "./index";
import type { RefactorOptions, RefactorResult } from "./types";
import type { LogCallback } from "../types";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Refactoring System Prompt Addition
// ============================================================================

export const REFACTORING_CONTEXT_PROMPT = `

## Refactoring Mode Enabled

After generating the raw Playwright script, the system will automatically:

1. **Analyze the target repository** to understand its structure and coding patterns
2. **Map your generated selectors** to existing Page Objects where possible
3. **Create new Page Object properties** for orphan selectors following the repository's style
4. **Generate a production-ready test file** that uses the repository's fixture pattern
5. **Verify the test runs successfully** and self-heal if needed

Focus on generating clear, well-structured raw Playwright code. The refactoring system will handle integration with the target repository.
`;

// ============================================================================
// Main Refactoring Agent
// ============================================================================

/**
 * Run the complete E2E refactoring flow:
 * 1. Generate raw Playwright code using AI + MCP
 * 2. Refactor the code to integrate with the target repository
 * 3. Verify the result
 */
export async function runRefactoringAgent(
    options: RefactorOptions,
    logCallback?: LogCallback
): Promise<RefactorResult> {
    const { instruction, outputDir, repoPath, baseUrl, timeout = 300000, verbose = false, dryRun = false } = options;

    const log = logCallback || (verbose ? (type: string, msg: string) => console.error(`[${type}] ${msg}`) : () => { });

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate timestamp for this run
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = path.join(outputDir, `qa-refactor-${timestamp}`);
    fs.mkdirSync(runDir, { recursive: true });

    // =========================================================================
    // Step 1: Generate Raw Playwright Code
    // =========================================================================
    log("output", "Step 1: Generating raw Playwright code...");

    const mcp = new McpRunner("npx", ["-y", "@playwright/mcp@latest"]);
    let rawCode = "";

    try {
        await mcp.connect();
        const agent = new AgentLoop(mcp, logCallback);

        // Generate the QA prompt (with refactoring context if needed)
        const prompt = generateQAPrompt(instruction, runDir, baseUrl);

        // Run the agent loop
        const agentResult = await agent.run(prompt);

        // Parse the agent's output
        const parsed = parseAgentOutput(agentResult);

        if (parsed.scriptContent) {
            rawCode = parsed.scriptContent;
            const rawScriptPath = path.join(runDir, "raw.spec.ts");
            fs.writeFileSync(rawScriptPath, rawCode, "utf-8");
            log("output", `  - Raw script saved: ${rawScriptPath}`);
        } else {
            return {
                success: false,
                rawScriptPath: "",
                modifiedFiles: [],
                generatedTestPath: null,
                errors: ["Failed to generate raw Playwright code"],
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            rawScriptPath: "",
            modifiedFiles: [],
            generatedTestPath: null,
            errors: [`Raw code generation failed: ${errorMessage}`],
        };
    } finally {
        await mcp.cleanup();
    }

    // =========================================================================
    // Step 2: Run Refactoring Pipeline
    // =========================================================================
    log("output", "Step 2: Running refactoring pipeline...");

    const refactorResult = await refactorPipeline(rawCode, {
        instruction,
        outputDir: runDir,
        repoPath,
        baseUrl,
        timeout,
        verbose,
        dryRun,
    });

    // Update raw script path
    refactorResult.rawScriptPath = path.join(runDir, "raw.spec.ts");

    // =========================================================================
    // Step 3: Generate Report
    // =========================================================================
    log("output", "Step 3: Generating report...");

    const reportPath = path.join(runDir, "refactor-report.json");
    const report = {
        timestamp: new Date().toISOString(),
        instruction,
        repoPath,
        success: refactorResult.success,
        rawScriptPath: refactorResult.rawScriptPath,
        generatedTestPath: refactorResult.generatedTestPath,
        modifiedFiles: refactorResult.modifiedFiles,
        errors: refactorResult.errors,
        knowledge: refactorResult.knowledge ? {
            repoType: refactorResult.knowledge.repoContext.repoType,
            locatorStyle: refactorResult.knowledge.styleVector.locatorStyle,
            pageObjectsFound: Object.keys(refactorResult.knowledge.pageObjectIndex).length,
            tokensExtracted: refactorResult.knowledge.rawTokens.length,
            clustersIdentified: refactorResult.knowledge.clusters.length,
            totalMappings: refactorResult.knowledge.mappings.length,
            orphanSelectors: refactorResult.knowledge.mappings.filter(m => m.isNewProperty).length,
        } : null,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    log("output", `  - Report saved: ${reportPath}`);

    return refactorResult;
}

// ============================================================================
// Standalone Refactor (No Code Generation)
// ============================================================================

/**
 * Refactor an existing raw Playwright script
 * (for cases where the raw code already exists)
 */
export async function refactorExistingScript(
    rawScriptPath: string,
    repoPath: string,
    outputDir: string,
    verbose: boolean = false
): Promise<RefactorResult> {
    if (!fs.existsSync(rawScriptPath)) {
        return {
            success: false,
            rawScriptPath,
            modifiedFiles: [],
            generatedTestPath: null,
            errors: [`Raw script not found: ${rawScriptPath}`],
        };
    }

    const rawCode = fs.readFileSync(rawScriptPath, "utf-8");

    return refactorPipeline(rawCode, {
        instruction: "Refactor existing script",
        outputDir,
        repoPath,
        verbose,
        dryRun: false,
    });
}
