/**
 * Phase I: Repository Reconnaissance
 * 
 * Builds a complete mental model of the target repository's architecture,
 * conventions, and coding patterns WITHOUT any prior knowledge.
 */

import * as fs from "fs";
import * as path from "path";
import type {
    RepoContext,
    StyleVector,
    PageObjectIndex,
    PageObjectData,
    LocatorEntry,
    MethodEntry,
    FixtureRegistry,
    FixtureEntry,
} from "./types";

// ============================================================================
// Directory Discovery Patterns
// ============================================================================

const PAGE_OBJECT_CANDIDATES = [
    "pages",
    "page-objects",
    "po",
    "src/pages",
    "lib/pages",
    "src/page-objects",
];

const TEST_DIR_CANDIDATES = [
    "tests",
    "test",
    "e2e",
    "spec",
    "src/tests",
    "__tests__",
];

const FIXTURE_PATTERNS = [
    "fixture.ts",
    "fixtures.ts",
    "test.extend.ts",
    "base.ts",
];

// ============================================================================
// Pattern Detection RegEx
// ============================================================================

// Detect wrapper class usage: new ClassName(this.page.getBy...)
const WRAPPER_PATTERN = /(\w+)\s*=\s*new\s+(\w+)\s*\(\s*this\.page\.(getBy\w+|locator)\s*\(/g;

// Detect native locator: readonly|public|private prop = this.page.getBy...
const NATIVE_PATTERN = /(readonly|public|private)\s+(\w+)\s*=\s*this\.page\.(getBy\w+|locator)\s*\(/g;

// Detect getter pattern: get propName() { return this.page... }
const GETTER_PATTERN = /get\s+(\w+)\s*\(\)\s*\{\s*return\s+this\.page\.(getBy\w+|locator)\s*\(/g;

// Detect base class: class ClassName extends BaseClass
const BASE_CLASS_PATTERN = /class\s+(\w+)\s+extends\s+(\w+)/;

// Extract selector from getByTestId('value')
const TESTID_SELECTOR_PATTERN = /getByTestId\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/;

// Extract selector from getByRole('role', { name: 'value' })
const ROLE_SELECTOR_PATTERN = /getByRole\s*\(\s*['"`](\w+)['"`]\s*(?:,\s*\{([^}]+)\})?\s*\)/;

// Extract selector from locator('css')
const CSS_SELECTOR_PATTERN = /locator\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/;

// Extract selector from getByLabel, getByPlaceholder, getByText
const TEXT_SELECTOR_PATTERN = /getBy(Label|Placeholder|Text)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/;

// ============================================================================
// Structure Discovery
// ============================================================================

/**
 * Discover the structure of the target repository
 */
export function discoverStructure(repoRoot: string): RepoContext {
    const context: RepoContext = {
        repoRoot,
        repoType: "UNKNOWN",
        pageObjectDir: null,
        testDir: null,
        usesFixtures: false,
        fixtureFile: null,
        configFile: null,
        baseClass: null,
    };

    // Ensure repo exists
    if (!fs.existsSync(repoRoot)) {
        throw new Error(`Repository not found: ${repoRoot}`);
    }

    // Find Page Object directory
    for (const candidate of PAGE_OBJECT_CANDIDATES) {
        const candidatePath = path.join(repoRoot, candidate);
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
            context.pageObjectDir = candidate;
            context.repoType = "STANDARD_POM";
            break;
        }
    }

    // Find Test directory
    for (const candidate of TEST_DIR_CANDIDATES) {
        const candidatePath = path.join(repoRoot, candidate);
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
            context.testDir = candidate;
            break;
        }
    }

    // Find fixture file
    if (context.pageObjectDir) {
        const poDir = path.join(repoRoot, context.pageObjectDir);
        for (const pattern of FIXTURE_PATTERNS) {
            const fixturePath = path.join(poDir, pattern);
            if (fs.existsSync(fixturePath)) {
                context.usesFixtures = true;
                context.fixtureFile = path.join(context.pageObjectDir, pattern);
                break;
            }
        }
    }

    // Check for playwright.config.ts
    const configPath = path.join(repoRoot, "playwright.config.ts");
    if (fs.existsSync(configPath)) {
        context.configFile = "playwright.config.ts";
    }

    return context;
}

// ============================================================================
// Pattern Detection (Style Vector)
// ============================================================================

/**
 * Detect coding style patterns from sample Page Object files
 */
export function detectPatterns(repoRoot: string, context: RepoContext): StyleVector {
    const style: StyleVector = {
        locatorStyle: "Native",
        wrapperClassName: null,
        baseClassName: null,
        propertyVisibility: "public",
        methodStyle: "Atomic",
        importStatements: [],
    };

    if (!context.pageObjectDir) {
        return style;
    }

    const poDir = path.join(repoRoot, context.pageObjectDir);

    // Get TypeScript files (excluding fixture files)
    const files = fs.readdirSync(poDir)
        .filter(f => f.endsWith(".ts") && !FIXTURE_PATTERNS.includes(f))
        .slice(0, 3); // Analyze first 3 files

    if (files.length === 0) {
        return style;
    }

    for (const file of files) {
        const filePath = path.join(poDir, file);
        const content = fs.readFileSync(filePath, "utf-8");

        // Detect wrapper class usage
        const wrapperMatches = [...content.matchAll(WRAPPER_PATTERN)];
        if (wrapperMatches.length > 0) {
            style.locatorStyle = "WrapperClass";
            style.wrapperClassName = wrapperMatches[0][2];
        }

        // Detect getter pattern
        if (GETTER_PATTERN.test(content)) {
            style.locatorStyle = "Getter";
        }

        // Detect base class
        const baseClassMatch = content.match(BASE_CLASS_PATTERN);
        if (baseClassMatch) {
            style.baseClassName = baseClassMatch[2];
        }

        // Detect visibility from native pattern
        const nativeMatches = [...content.matchAll(NATIVE_PATTERN)];
        if (nativeMatches.length > 0) {
            style.propertyVisibility = nativeMatches[0][1] as "readonly" | "public" | "private";
        }

        // Extract import statements
        const importMatches = content.match(/^import\s+.*$/gm);
        if (importMatches) {
            for (const imp of importMatches) {
                if (!style.importStatements.includes(imp)) {
                    style.importStatements.push(imp);
                }
            }
        }
    }

    return style;
}

// ============================================================================
// Page Object Indexing
// ============================================================================

/**
 * Extract locator information from a locator expression
 */
function parseLocatorExpression(code: string, lineNumber: number): LocatorEntry | null {
    // Try getByTestId
    const testIdMatch = code.match(TESTID_SELECTOR_PATTERN);
    if (testIdMatch) {
        const propNameMatch = code.match(/(\w+)\s*=/);
        return {
            propertyName: propNameMatch?.[1] || "unknown",
            selectorType: "testid",
            selectorValue: testIdMatch[1],
            rawCode: code.trim(),
            lineNumber,
        };
    }

    // Try getByRole
    const roleMatch = code.match(ROLE_SELECTOR_PATTERN);
    if (roleMatch) {
        const propNameMatch = code.match(/(\w+)\s*=/);
        const options: Record<string, any> = {};
        if (roleMatch[2]) {
            const nameMatch = roleMatch[2].match(/name:\s*['"`]([^'"`]+)['"`]/);
            if (nameMatch) {
                options.name = nameMatch[1];
            }
        }
        return {
            propertyName: propNameMatch?.[1] || "unknown",
            selectorType: "role",
            selectorValue: roleMatch[1],
            selectorOptions: options,
            rawCode: code.trim(),
            lineNumber,
        };
    }

    // Try locator (CSS)
    const cssMatch = code.match(CSS_SELECTOR_PATTERN);
    if (cssMatch) {
        const propNameMatch = code.match(/(\w+)\s*=/);
        return {
            propertyName: propNameMatch?.[1] || "unknown",
            selectorType: "css",
            selectorValue: cssMatch[1],
            rawCode: code.trim(),
            lineNumber,
        };
    }

    // Try getByLabel/Placeholder/Text
    const textMatch = code.match(TEXT_SELECTOR_PATTERN);
    if (textMatch) {
        const propNameMatch = code.match(/(\w+)\s*=/);
        return {
            propertyName: propNameMatch?.[1] || "unknown",
            selectorType: textMatch[1].toLowerCase() as "label" | "placeholder" | "text",
            selectorValue: textMatch[2],
            rawCode: code.trim(),
            lineNumber,
        };
    }

    return null;
}

/**
 * Extract methods from Page Object file content
 */
function extractMethods(content: string): MethodEntry[] {
    const methods: MethodEntry[] = [];
    const lines = content.split("\n");

    // Pattern for async methods: async methodName(params): returnType {
    const methodPattern = /^\s*(public\s+|private\s+|protected\s+)?(async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(methodPattern);
        if (match && match[3] !== "constructor") {
            methods.push({
                methodName: match[3],
                parameters: match[4] ? match[4].split(",").map(p => p.trim()).filter(p => p) : [],
                returnType: match[5]?.trim() || "void",
                lineNumber: i + 1,
            });
        }
    }

    return methods;
}

/**
 * Index a single Page Object file
 */
function indexPageObjectFile(filePath: string): PageObjectData | null {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Extract class name and base class
    const classMatch = content.match(BASE_CLASS_PATTERN);
    if (!classMatch) {
        // Try to find class without extends
        const simpleClassMatch = content.match(/class\s+(\w+)/);
        if (!simpleClassMatch) {
            return null;
        }
    }

    const className = classMatch?.[1] || content.match(/class\s+(\w+)/)?.[1];
    if (!className) {
        return null;
    }

    const locators: LocatorEntry[] = [];

    // Find all locator assignments
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("this.page.") && (line.includes("getBy") || line.includes("locator"))) {
            const locator = parseLocatorExpression(line, i + 1);
            if (locator) {
                locators.push(locator);
            }
        }
    }

    // Extract methods
    const methods = extractMethods(content);

    // Extract imports
    const imports = content.match(/^import\s+.*$/gm) || [];

    return {
        className,
        filePath,
        baseClass: classMatch?.[2] || null,
        locators,
        methods,
        fixtureAlias: className.charAt(0).toLowerCase() + className.slice(1).replace("Page", "Page"),
        imports,
    };
}

/**
 * Build complete index of all Page Objects in repository
 */
export function indexPageObjects(repoRoot: string, context: RepoContext): PageObjectIndex {
    const index: PageObjectIndex = {};

    if (!context.pageObjectDir) {
        return index;
    }

    const poDir = path.join(repoRoot, context.pageObjectDir);

    // Get all TypeScript files (excluding fixture files)
    const files = fs.readdirSync(poDir)
        .filter(f => f.endsWith(".ts") && !FIXTURE_PATTERNS.includes(f));

    for (const file of files) {
        const filePath = path.join(poDir, file);
        const pageObject = indexPageObjectFile(filePath);
        if (pageObject) {
            index[pageObject.className] = pageObject;
        }
    }

    return index;
}

// ============================================================================
// Fixture Registry Parsing
// ============================================================================

/**
 * Parse fixture file to extract fixture-to-class mappings
 */
export function parseFixtureRegistry(repoRoot: string, context: RepoContext): FixtureRegistry {
    const registry: FixtureRegistry = {};

    if (!context.usesFixtures || !context.fixtureFile) {
        return registry;
    }

    const fixturePath = path.join(repoRoot, context.fixtureFile);
    if (!fs.existsSync(fixturePath)) {
        return registry;
    }

    const content = fs.readFileSync(fixturePath, "utf-8");

    // Pattern to match fixture definitions: fixtureName: async ({ page }, use) => { await use(new ClassName(page)); }
    const fixturePattern = /(\w+):\s*async\s*\(\s*\{[^}]*\}\s*,\s*use\s*\)\s*=>\s*\{[^}]*use\s*\(\s*new\s+(\w+)\s*\([^)]*\)\s*\)/g;

    let match;
    while ((match = fixturePattern.exec(content)) !== null) {
        const [, fixtureName, className] = match;
        registry[fixtureName] = {
            className,
            filePath: context.fixtureFile!,
            instantiation: `new ${className}(page)`,
        };
    }

    // Also try to extract from type definition
    const typePattern = /type\s+\w+\s*=\s*\{([^}]+)\}/;
    const typeMatch = content.match(typePattern);
    if (typeMatch) {
        const typeContent = typeMatch[1];
        const entries = typeContent.match(/(\w+):\s*(\w+)/g) || [];
        for (const entry of entries) {
            const [fixtureName, className] = entry.split(":").map(s => s.trim());
            if (fixtureName && className && !registry[fixtureName]) {
                registry[fixtureName] = {
                    className,
                    filePath: context.fixtureFile!,
                    instantiation: `new ${className}(page)`,
                };
            }
        }
    }

    return registry;
}

// ============================================================================
// Main Reconnaissance Function
// ============================================================================

/**
 * Perform complete repository reconnaissance
 */
export async function performReconnaissance(repoRoot: string): Promise<{
    repoContext: RepoContext;
    styleVector: StyleVector;
    pageObjectIndex: PageObjectIndex;
    fixtureRegistry: FixtureRegistry;
}> {
    // Step 1: Discover structure
    const repoContext = discoverStructure(repoRoot);

    // Step 2: Detect patterns
    const styleVector = detectPatterns(repoRoot, repoContext);

    // Step 3: Index Page Objects
    const pageObjectIndex = indexPageObjects(repoRoot, repoContext);

    // Step 4: Parse fixture registry
    const fixtureRegistry = parseFixtureRegistry(repoRoot, repoContext);

    // Update base class if detected
    if (styleVector.baseClassName) {
        repoContext.baseClass = styleVector.baseClassName;
    }

    return {
        repoContext,
        styleVector,
        pageObjectIndex,
        fixtureRegistry,
    };
}
