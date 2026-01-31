/**
 * Phase II: Input Parsing
 * 
 * Transform raw Playwright codegen output into structured 
 * "Semantic Action Chain" that can be reasoned about.
 */

import type {
    ActionToken,
    LocatorInfo,
    Cluster,
    TestDataItem,
} from "./types";

// ============================================================================
// Tokenization Patterns
// ============================================================================

// Pattern 1: page.action(selector) or page.action(selector, value)
const ACTION_DIRECT_PATTERN = /await\s+page\.(click|fill|type|check|uncheck|press|hover|dblclick|selectOption)\s*\(\s*(.*?)\s*(?:,\s*['"`](.*)['"`])?\s*\)/;

// Pattern 2: page.locator/getBy(...).action()
const ACTION_CHAIN_PATTERN = /await\s+page\.(locator|getBy\w+)\s*\(([^)]+)\)\.(\w+)\s*\(([^)]*)\)/;

// Pattern 3: await page.goto(url)
const GOTO_PATTERN = /await\s+page\.goto\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/;

// Pattern 4: await page.waitForURL(pattern)
const WAIT_URL_PATTERN = /await\s+page\.waitForURL\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/;

// Pattern 5: const variable = page.locator/getBy(...)
const VARIABLE_PATTERN = /const\s+(\w+)\s*=\s*page\.(locator|getBy\w+)\s*\(([^)]+)\)/;

// Pattern 6: await variable.action()
const VARIABLE_ACTION_PATTERN = /await\s+(\w+)\.(click|fill|type|check|uncheck|press|hover|dblclick|textContent|innerText|inputValue)\s*\(([^)]*)\)/;

// Pattern 7: expect(locator).assertion()
const EXPECT_PATTERN = /await\s+expect\s*\(\s*(.*?)\s*\)\.(toBeVisible|toHaveText|toHaveValue|toContainText|toBe|toHaveCSS|toBeChecked|toBeEnabled|toBeDisabled)\s*\(([^)]*)\)/;

// Pattern 8: const VAR = 'value' or const VAR = "value"
const CONST_PATTERN = /const\s+(\w+)\s*=\s*['"`]([^'"`]+)['"`]/;

// ============================================================================
// Locator Parsing
// ============================================================================

/**
 * Parse a locator expression into a LocatorInfo object
 */
export function parseLocator(expression: string): LocatorInfo | null {
    if (!expression) return null;

    const trimmed = expression.trim();

    // getByTestId('value')
    const testIdMatch = trimmed.match(/getByTestId\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (testIdMatch) {
        return {
            type: "testid",
            value: testIdMatch[1],
            options: {},
            fullExpression: trimmed,
        };
    }

    // getByRole('role', { name: 'value' })
    const roleMatch = trimmed.match(/getByRole\s*\(\s*['"`](\w+)['"`]\s*(?:,\s*\{([^}]+)\})?\s*\)/);
    if (roleMatch) {
        const options: Record<string, any> = {};
        if (roleMatch[2]) {
            const nameMatch = roleMatch[2].match(/name:\s*['"`]([^'"`]+)['"`]/);
            if (nameMatch) {
                options.name = nameMatch[1];
            }
            const exactMatch = roleMatch[2].match(/exact:\s*(true|false)/);
            if (exactMatch) {
                options.exact = exactMatch[1] === "true";
            }
        }
        return {
            type: "role",
            value: roleMatch[1],
            options,
            fullExpression: trimmed,
        };
    }

    // getByLabel('value')
    const labelMatch = trimmed.match(/getByLabel\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (labelMatch) {
        return {
            type: "label",
            value: labelMatch[1],
            options: {},
            fullExpression: trimmed,
        };
    }

    // getByPlaceholder('value')
    const placeholderMatch = trimmed.match(/getByPlaceholder\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (placeholderMatch) {
        return {
            type: "placeholder",
            value: placeholderMatch[1],
            options: {},
            fullExpression: trimmed,
        };
    }

    // getByText('value')
    const textMatch = trimmed.match(/getByText\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (textMatch) {
        return {
            type: "text",
            value: textMatch[1],
            options: {},
            fullExpression: trimmed,
        };
    }

    // locator('css selector')
    const cssMatch = trimmed.match(/locator\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (cssMatch) {
        return {
            type: "css",
            value: cssMatch[1],
            options: {},
            fullExpression: trimmed,
        };
    }

    // For expressions like 'selector' passed directly
    if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith("`")) {
        const value = trimmed.slice(1, -1);
        // Check if it looks like a test ID
        if (value.match(/^[a-z0-9-_]+$/i)) {
            return {
                type: "testid",
                value,
                options: {},
                fullExpression: trimmed,
            };
        }
        // Otherwise treat as CSS
        return {
            type: "css",
            value,
            options: {},
            fullExpression: trimmed,
        };
    }

    return null;
}

/**
 * Extract locator from expect expression
 */
function parseExpectLocator(expression: string): LocatorInfo | null {
    // expect(page.getBy...())
    if (expression.includes("page.")) {
        return parseLocator(expression);
    }
    // expect(variable.controlLocator) or expect(variable)
    const varMatch = expression.match(/^(\w+)(?:\.(\w+))?$/);
    if (varMatch) {
        return {
            type: "css",
            value: varMatch[1],
            options: { isVariable: true },
            fullExpression: expression,
        };
    }
    return null;
}

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Tokenize a single line of raw Playwright code
 */
export function tokenizeLine(line: string, lineNumber: number): ActionToken | null {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
        return null;
    }

    // Skip imports and test definitions
    if (trimmed.startsWith("import ") || trimmed.startsWith("test(") || trimmed.startsWith("test.describe")) {
        return null;
    }

    // Pattern: await page.goto(url)
    const gotoMatch = line.match(GOTO_PATTERN);
    if (gotoMatch) {
        return {
            lineNumber,
            rawCode: trimmed,
            actor: "page",
            action: "goto",
            locator: null,
            value: gotoMatch[1],
            isAssertion: false,
        };
    }

    // Pattern: await page.waitForURL(pattern)
    const waitUrlMatch = line.match(WAIT_URL_PATTERN);
    if (waitUrlMatch) {
        return {
            lineNumber,
            rawCode: trimmed,
            actor: "page",
            action: "waitForURL",
            locator: null,
            value: waitUrlMatch[1],
            isAssertion: false,
        };
    }

    // Pattern: const variable = page.locator/getBy(...)
    const varMatch = line.match(VARIABLE_PATTERN);
    if (varMatch) {
        const locatorExpr = `${varMatch[2]}(${varMatch[3]})`;
        return {
            lineNumber,
            rawCode: trimmed,
            actor: "page",
            action: "assign",
            locator: parseLocator(locatorExpr),
            value: null,
            isAssertion: false,
            variableName: varMatch[1],
        };
    }

    // Pattern: await page.locator(...).action()
    const chainMatch = line.match(ACTION_CHAIN_PATTERN);
    if (chainMatch) {
        const locatorExpr = `${chainMatch[1]}(${chainMatch[2]})`;
        const action = chainMatch[3] as ActionToken["action"];
        const value = chainMatch[4]?.replace(/^['"`]|['"`]$/g, "") || null;
        return {
            lineNumber,
            rawCode: trimmed,
            actor: "page",
            action: action === "fill" || action === "type" ? action :
                action === "click" ? "click" :
                    action === "check" ? "check" :
                        action === "textContent" ? "textContent" : "other",
            locator: parseLocator(locatorExpr),
            value: value && value !== "" ? value : null,
            isAssertion: false,
        };
    }

    // Pattern: await variable.action()
    const varActionMatch = line.match(VARIABLE_ACTION_PATTERN);
    if (varActionMatch) {
        return {
            lineNumber,
            rawCode: trimmed,
            actor: varActionMatch[1],
            action: varActionMatch[2] as ActionToken["action"],
            locator: null,
            value: varActionMatch[3]?.replace(/^['"`]|['"`]$/g, "") || null,
            isAssertion: false,
        };
    }

    // Pattern: await expect(...).assertion()
    const expectMatch = line.match(EXPECT_PATTERN);
    if (expectMatch) {
        return {
            lineNumber,
            rawCode: trimmed,
            actor: "page",
            action: "expect",
            locator: parseExpectLocator(expectMatch[1]),
            value: expectMatch[3]?.replace(/^['"`]|['"`]$/g, "") || null,
            isAssertion: true,
        };
    }

    return null;
}

/**
 * Tokenize raw Playwright script into ActionToken array
 */
export function tokenize(rawCode: string): ActionToken[] {
    const lines = rawCode.split("\n");
    const tokens: ActionToken[] = [];

    for (let i = 0; i < lines.length; i++) {
        const token = tokenizeLine(lines[i], i + 1);
        if (token) {
            tokens.push(token);
        }
    }

    return tokens;
}

// ============================================================================
// Clustering
// ============================================================================

/**
 * Check if a locator is related to authentication
 */
function isAuthRelated(locator: LocatorInfo | null): boolean {
    if (!locator) return false;

    const authKeywords = ["email", "password", "login", "signin", "sign-in", "username", "auth", "credential"];
    const value = locator.value.toLowerCase();
    const name = locator.options?.name?.toLowerCase() || "";

    return authKeywords.some(kw => value.includes(kw) || name.includes(kw));
}

/**
 * Check if a locator represents a container/menu element
 */
function isContainerElement(locator: LocatorInfo | null): boolean {
    if (!locator) return false;

    const containerKeywords = ["menu", "dropdown", "modal", "dialog", "popup", "profile", "nav", "sidebar"];
    const value = locator.value.toLowerCase();
    const name = locator.options?.name?.toLowerCase() || "";

    return containerKeywords.some(kw => value.includes(kw) || name.includes(kw));
}

/**
 * Cluster tokens by semantic intent
 */
export function cluster(tokens: ActionToken[]): Cluster[] {
    const clusters: Cluster[] = [];
    let currentCluster: Cluster = {
        id: "cluster_0",
        type: "GENERIC",
        intent: "",
        tokens: [],
        assertions: [],
    };
    let clusterIndex = 0;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Rule 1: Navigation always starts a new cluster
        if (token.action === "goto") {
            if (currentCluster.tokens.length > 0) {
                currentCluster.intent = generateClusterIntent(currentCluster);
                clusters.push(currentCluster);
                clusterIndex++;
            }
            currentCluster = {
                id: `cluster_${clusterIndex}`,
                type: "NAVIGATION",
                intent: `Navigate to ${token.value}`,
                tokens: [token],
                assertions: [],
            };
            continue;
        }

        // Rule 2: Assertions belong to the current cluster
        if (token.isAssertion) {
            currentCluster.assertions.push(token);
            currentCluster.tokens.push(token);
            continue;
        }

        // Rule 3: Check for auth pattern
        if (isAuthRelated(token.locator)) {
            if (currentCluster.type !== "AUTHENTICATION") {
                if (currentCluster.tokens.length > 0) {
                    currentCluster.intent = generateClusterIntent(currentCluster);
                    clusters.push(currentCluster);
                    clusterIndex++;
                }
                currentCluster = {
                    id: `cluster_${clusterIndex}`,
                    type: "AUTHENTICATION",
                    intent: "Login flow",
                    tokens: [],
                    assertions: [],
                };
            }
            currentCluster.tokens.push(token);
            continue;
        }

        // Rule 4: Menu interaction pattern
        if (token.action === "click" && i > 0) {
            const prevToken = tokens[i - 1];
            if (prevToken.action === "click" && isContainerElement(prevToken.locator)) {
                currentCluster.type = "MENU_INTERACTION";
                currentCluster.tokens.push(token);
                continue;
            }
        }

        // Rule 5: Form submission pattern (consecutive fills followed by click)
        if (token.action === "fill" || token.action === "type") {
            if (currentCluster.type !== "FORM_SUBMISSION" && currentCluster.type !== "AUTHENTICATION") {
                if (currentCluster.tokens.length > 0) {
                    currentCluster.intent = generateClusterIntent(currentCluster);
                    clusters.push(currentCluster);
                    clusterIndex++;
                }
                currentCluster = {
                    id: `cluster_${clusterIndex}`,
                    type: "FORM_SUBMISSION",
                    intent: "Form input",
                    tokens: [],
                    assertions: [],
                };
            }
            currentCluster.tokens.push(token);
            continue;
        }

        // Default: Add to current cluster
        currentCluster.tokens.push(token);
    }

    // Push final cluster
    if (currentCluster.tokens.length > 0) {
        currentCluster.intent = generateClusterIntent(currentCluster);
        clusters.push(currentCluster);
    }

    return clusters;
}

/**
 * Generate human-readable intent for a cluster
 */
function generateClusterIntent(cluster: Cluster): string {
    switch (cluster.type) {
        case "NAVIGATION":
            const gotoToken = cluster.tokens.find(t => t.action === "goto");
            return gotoToken ? `Navigate to ${gotoToken.value}` : "Navigate";

        case "AUTHENTICATION":
            return "Authenticate user / Login flow";

        case "FORM_SUBMISSION":
            return "Fill form fields";

        case "MENU_INTERACTION":
            const clickTokens = cluster.tokens.filter(t => t.action === "click");
            if (clickTokens.length >= 2) {
                const menuToken = clickTokens[0];
                const actionToken = clickTokens[clickTokens.length - 1];
                const menu = menuToken.locator?.value || "menu";
                const action = actionToken.locator?.value || "item";
                return `Open ${menu} and select ${action}`;
            }
            return "Menu interaction";

        case "VERIFICATION":
            return "Verify expected state";

        default:
            return "Perform actions";
    }
}

// ============================================================================
// Variable and Test Data Resolution
// ============================================================================

/**
 * Extract test data (constants/variables) from raw code
 */
export function extractTestData(rawCode: string): TestDataItem[] {
    const testData: TestDataItem[] = [];
    const lines = rawCode.split("\n");

    // Track which constants are used where
    const usageMap = new Map<string, string>();

    for (const line of lines) {
        // Find const declarations with string values
        const constMatch = line.match(CONST_PATTERN);
        if (constMatch) {
            const [, varName, value] = constMatch;

            // Check if it's used in fill/type (making it test data, not a locator)
            // Look for patterns like: varName = page.locator vs. fill(.., varName)
            const isLocatorAssignment = line.includes("page.") && (line.includes("locator") || line.includes("getBy"));

            if (!isLocatorAssignment) {
                testData.push({
                    variableName: varName,
                    value,
                    type: "string",
                    usage: "other",
                });
            }
        }
    }

    // Second pass: Determine usage
    for (const item of testData) {
        const fillUsage = rawCode.match(new RegExp(`\\.fill\\s*\\([^,]+,\\s*${item.variableName}\\s*\\)`));
        const typeUsage = rawCode.match(new RegExp(`\\.type\\s*\\([^,]+,\\s*${item.variableName}\\s*\\)`));
        const expectUsage = rawCode.match(new RegExp(`expect.*${item.variableName}`));

        if (fillUsage || typeUsage) {
            item.usage = "fill";
        } else if (expectUsage) {
            item.usage = "assertion";
        }
    }

    return testData;
}

// ============================================================================
// Main Parse Function
// ============================================================================

/**
 * Parse raw Playwright code into structured semantic representation
 */
export function parseRawCode(rawCode: string): {
    tokens: ActionToken[];
    clusters: Cluster[];
    testData: TestDataItem[];
} {
    const tokens = tokenize(rawCode);
    const clusters = cluster(tokens);
    const testData = extractTestData(rawCode);

    return {
        tokens,
        clusters,
        testData,
    };
}
