/**
 * E2E Refactoring Pipeline - Main Orchestrator
 * 
 * Combines all phases into a unified pipeline that transforms
 * raw Playwright code into repository-ready POM code.
 */

import * as fs from "fs";
import * as path from "path";

// Phase imports
import { performReconnaissance } from "./reconnaissance";
import { parseRawCode } from "./parser";
import { mapAllOrphans, getOrphanSelectors } from "./mapper";
import {
    generatePageObjectMods,
    generateTestFile,
    applyPageObjectMod,
} from "./generator";
import { verifyAndFix, analyzeTestFile } from "./verifier";

// Types
import type {
    KnowledgeGraph,
    RefactorOptions,
    RefactorResult,
} from "./types";

// ============================================================================
// Main Pipeline
// ============================================================================

/**
 * Execute the complete refactoring pipeline
 */
export async function refactorPipeline(
    rawCode: string,
    options: RefactorOptions
): Promise<RefactorResult> {
    const { repoPath, outputDir, verbose = false, dryRun = false } = options;
    const errors: string[] = [];
    const modifiedFiles: string[] = [];

    const log = verbose
        ? (msg: string) => console.error(`[REFACTOR] ${msg}`)
        : () => { };

    try {
        // ========================================================================
        // Phase I: Repository Reconnaissance
        // ========================================================================
        log("Phase I: Repository Reconnaissance...");

        const { repoContext, styleVector, pageObjectIndex, fixtureRegistry } =
            await performReconnaissance(repoPath);

        log(`  - Repo type: ${repoContext.repoType}`);
        log(`  - Page Object dir: ${repoContext.pageObjectDir}`);
        log(`  - Locator style: ${styleVector.locatorStyle}`);
        log(`  - Page Objects found: ${Object.keys(pageObjectIndex).length}`);

        if (repoContext.repoType === "UNKNOWN") {
            errors.push("Could not detect repository structure. Missing pages/ directory?");
        }

        // ========================================================================
        // Phase II: Input Parsing
        // ========================================================================
        log("Phase II: Parsing raw code...");

        const { tokens, clusters, testData } = parseRawCode(rawCode);

        log(`  - Tokens extracted: ${tokens.length}`);
        log(`  - Clusters identified: ${clusters.length}`);
        log(`  - Test data items: ${testData.length}`);

        // ========================================================================
        // Phase III: Mapping
        // ========================================================================
        log("Phase III: Mapping selectors to Page Objects...");

        const mappings = mapAllOrphans(tokens, pageObjectIndex);
        const orphans = getOrphanSelectors(mappings);

        log(`  - Total mappings: ${mappings.length}`);
        log(`  - Orphan selectors (new): ${orphans.length}`);
        log(`  - Existing selectors: ${mappings.length - orphans.length}`);

        // ========================================================================
        // Phase IV: Code Synthesis
        // ========================================================================
        log("Phase IV: Generating code...");

        // Generate Page Object modifications
        const pageObjectMods = generatePageObjectMods(
            mappings,
            clusters,
            pageObjectIndex,
            styleVector
        );

        log(`  - Page Objects to modify: ${pageObjectMods.length}`);

        // Generate test file
        const testName = extractTestName(options.instruction);
        const testFileName = generateTestFileName(testName);
        const testFilePath = path.join(
            repoPath,
            repoContext.testDir || "tests",
            testFileName
        );

        const generatedTest = generateTestFile(
            clusters,
            mappings,
            fixtureRegistry,
            testName,
            testFilePath,
            styleVector
        );

        log(`  - Test file: ${testFilePath}`);

        // Build knowledge graph
        const knowledge: KnowledgeGraph = {
            repoContext,
            styleVector,
            pageObjectIndex,
            fixtureRegistry,
            rawCode,
            rawTokens: tokens,
            clusters,
            testData,
            mappings,
            pageObjectMods,
            generatedTest,
        };

        // ========================================================================
        // Apply Changes (unless dry run)
        // ========================================================================
        if (!dryRun) {
            log("Applying changes...");

            // Apply Page Object modifications
            for (const mod of pageObjectMods) {
                const filePath = path.join(repoPath, mod.filePath);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, "utf-8");
                    const newContent = applyPageObjectMod(content, mod);
                    fs.writeFileSync(filePath, newContent, "utf-8");
                    modifiedFiles.push(mod.filePath);
                    log(`  - Modified: ${mod.filePath}`);
                }
            }

            // Write test file
            const testDir = path.dirname(testFilePath);
            if (!fs.existsSync(testDir)) {
                fs.mkdirSync(testDir, { recursive: true });
            }
            fs.writeFileSync(testFilePath, generatedTest.content, "utf-8");
            modifiedFiles.push(testFilePath);
            log(`  - Created: ${testFilePath}`);

            // ========================================================================
            // Phase V: Verification
            // ========================================================================
            log("Phase V: Verification...");

            const verification = await verifyAndFix(
                testFilePath,
                repoPath,
                3,
                verbose
            );

            if (verification.passed) {
                log(`  - Test passed after ${verification.attempts} attempt(s)`);
            } else {
                log(`  - Test failed after ${verification.attempts} attempts`);
                for (const error of verification.errors) {
                    errors.push(`${error.type}: ${error.message}`);
                }
            }

            return {
                success: verification.passed,
                rawScriptPath: path.join(outputDir, "raw.spec.ts"),
                modifiedFiles,
                generatedTestPath: testFilePath,
                errors,
                knowledge,
            };
        } else {
            // Dry run - just analyze
            log("Dry run mode - no changes applied");

            const analysis = analyzeTestFile(testFilePath);
            if (!analysis.hasValidStructure) {
                errors.push(...analysis.warnings);
            }

            return {
                success: true,
                rawScriptPath: path.join(outputDir, "raw.spec.ts"),
                modifiedFiles: [],
                generatedTestPath: null,
                errors,
                knowledge,
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Pipeline error: ${errorMessage}`);

        return {
            success: false,
            rawScriptPath: path.join(outputDir, "raw.spec.ts"),
            modifiedFiles,
            generatedTestPath: null,
            errors,
        };
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract a test name from the instruction
 */
function extractTestName(instruction: string): string {
    // Take first 50 chars, clean up
    const cleaned = instruction
        .substring(0, 50)
        .replace(/[^\w\s]/g, "")
        .trim();

    return cleaned || "Generated Test";
}

/**
 * Generate a test file name from the test name
 */
function generateTestFileName(testName: string): string {
    const slug = testName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .substring(0, 30);

    return `${slug}.spec.ts`;
}

// ============================================================================
// Exports
// ============================================================================

export { performReconnaissance } from "./reconnaissance";
export { parseRawCode, tokenize, cluster } from "./parser";
export { mapAllOrphans, directHitSearch, semanticScoring } from "./mapper";
export {
    generateProperty,
    generateMethod,
    generatePageObjectMods,
    generateTestFile,
} from "./generator";
export { verifyAndFix, classifyError, runTest } from "./verifier";
export * from "./types";
