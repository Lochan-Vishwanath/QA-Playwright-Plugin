import { RelevantContext, PageObjectInfo } from "./types";

export const REFACTOR_PROMPT_TEMPLATE = 
"You are an expert Playwright Test Engineer specializing in the Page Object Model (POM) pattern.\\n" +
"Your goal is to refactor raw, recorded Playwright code into clean, maintainable code that strictly follows this project's existing structure.\\n\\n" +

"### 1. THE CONTEXT (Existing Page Objects)\\n" +
"The following Page Objects are available in the project. We have identified them as relevant based on the selectors used in the raw code.\\n" +
"ONLY use the methods listed below. Do NOT invent new methods unless absolutely necessary.\\n\\n" +

"{{relevantPageObjectsContext}}\\n\\n" +

"### 2. THE RAW INPUT\\n" +
"{{rawCode}}\\n\\n" +

"### 3. THE REQUIREMENTS\\n" +
"- **Pattern Matching**: Replace raw `page.click()` or `page.fill()` calls with the corresponding Page Object methods.\\n" +
"- **Instantiation**: If a Page Object is needed, instantiate it at the top of the test (e.g., `const loginPage = new LoginPage(page);`).\\n" +
"- **Missing Methods**: If the raw code performs an action that has NO matching method in the Page Object:\\n" +
"  - Option A: Create a NEW method in the Page Object class definition (wrapped in a `// NEW METHOD` comment).\\n" +
"  - Option B: Use the existing public locators if available.\\n" +
"- **Assertions**: Convert generic assertions to Playwright's `expect()` pattern.\\n\\n" +

"### 4. OUTPUT FORMAT\\n" +
"Return ONLY the code blocks.\\n" +
"- Block 1: The Refactored Test Code.\\n" +
"- Block 2: (Optional) Updates to Page Object files (if new methods were added).\\n";

export function generateRefactorPrompt(rawCode: string, context: RelevantContext): string {
    const contextString = formatContext(context.relevantPages);
    return REFACTOR_PROMPT_TEMPLATE
        .replace("{{relevantPageObjectsContext}}", contextString)
        .replace("{{rawCode}}", rawCode);
}

function formatContext(pages: PageObjectInfo[]): string {
    if (pages.length === 0) {
        return "No relevant Page Objects found. Please create new ones if needed.";
    }

    return pages.map(page => {
        const methods = page.methods.map(m => 
            "  - " + m.name + "(" + m.parameters.join(", ") + "): " + m.returnType
        ).join("\\n");
        
        return "\\n" +
               "Class: " + page.className + "\\n" +
               "File: " + page.filePath + "\\n" +
               "Methods:\\n" +
               methods + "\\n";
    }).join("\\n---");
}
