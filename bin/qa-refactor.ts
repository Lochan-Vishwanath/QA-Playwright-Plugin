#!/usr/bin/env node
import { POMIndexer } from "../src/features/smart-refactor/indexer";
import { ContextMatcher } from "../src/features/smart-refactor/matcher";
import { generateRefactorPrompt } from "../src/features/smart-refactor/prompt";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: qa-refactor <path-to-raw-code-file> [project-root]");
        process.exit(1);
    }

    const rawCodePath = args[0];
    const projectRoot = args[1] || process.cwd();

    console.log(`🔍 Scanning project structure in ${projectRoot}...`);
    
    const indexer = new POMIndexer();
    const index = await indexer.index(projectRoot);
    const pageCount = Object.keys(index).length;
    
    if (pageCount === 0) {
        console.warn("⚠️  No Page Objects found. Is this a POM project?");
    } else {
        console.log(`✅ Found ${pageCount} Page Objects.`);
    }

    let rawCode;
    try {
        rawCode = fs.readFileSync(rawCodePath, 'utf-8');
    } catch (e) {
        console.error(`❌ Could not read file: ${rawCodePath}`);
        process.exit(1);
    }

    console.log("🧩 Matching selectors to Page Objects...");
    const matcher = new ContextMatcher();
    const context = matcher.match(rawCode, index);
    
    console.log(`   matched ${context.relevantPages.length} relevant pages.`);
    context.relevantPages.forEach(p => console.log(`   - ${p.className} (${p.filePath})`));

    const prompt = generateRefactorPrompt(rawCode, context);
    
    console.log("\n🚀 GENERATED PROMPT FOR LLM:\n");
    console.log("=========================================");
    console.log(prompt);
    console.log("=========================================");
    console.log("\n💡 Copy the prompt above and paste it into your LLM to get the refactored code.");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
