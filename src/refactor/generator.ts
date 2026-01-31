/**
 * Phase IV: Code Synthesis
 * 
 * Generate syntactically correct, style-matched code that 
 * integrates seamlessly into the target repository.
 */

import * as path from "path";
import type {
    StyleVector,
    LocatorInfo,
    SelectorMapping,
    PageObjectMod,
    GeneratedTest,
    PageObjectIndex,
    Cluster,
    ActionToken,
    FixtureRegistry,
} from "./types";

// ============================================================================
// Property Generation (Chameleon Strategy)
// ============================================================================

/**
 * Convert selector value to human-readable title
 */
function toTitleCase(str: string): string {
    return str
        .split(/[-_\s]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

/**
 * Generate locator expression based on selector type
 */
function generateLocatorExpression(locator: LocatorInfo): string {
    switch (locator.type) {
        case "testid":
            return `getByTestId('${locator.value}')`;

        case "role": {
            const opts = locator.options || {};
            if (Object.keys(opts).length > 0) {
                const optsStr = Object.entries(opts)
                    .map(([k, v]) => `${k}: '${v}'`)
                    .join(", ");
                return `getByRole('${locator.value}', { ${optsStr} })`;
            }
            return `getByRole('${locator.value}')`;
        }

        case "label":
            return `getByLabel('${locator.value}')`;

        case "placeholder":
            return `getByPlaceholder('${locator.value}')`;

        case "text":
            return `getByText('${locator.value}')`;

        case "css":
            return `locator('${locator.value}')`;

        case "xpath":
            return `locator('xpath=${locator.value}')`;

        default:
            return `locator('${locator.value}')`;
    }
}

/**
 * Generate a property line based on the repository's style
 */
export function generateProperty(
    mapping: SelectorMapping,
    style: StyleVector
): string {
    const propertyName = mapping.targetProperty;
    const locatorExpr = generateLocatorExpression(mapping.selector);

    switch (style.locatorStyle) {
        case "WrapperClass": {
            const humanName = toTitleCase(mapping.selector.value);
            const wrapperClass = style.wrapperClassName || "WebControl";
            return `  ${style.propertyVisibility} ${propertyName} = new ${wrapperClass}(this.page.${locatorExpr}, '${humanName}')`;
        }

        case "Getter":
            return `  get ${propertyName}() { return this.page.${locatorExpr}; }`;

        case "Native":
        default:
            return `  ${style.propertyVisibility} ${propertyName} = this.page.${locatorExpr}`;
    }
}

// ============================================================================
// Method Generation
// ============================================================================

/**
 * Generate method name from intent or action tokens
 */
function generateMethodName(cluster: Cluster): string {
    // For menu interactions, extract the action
    if (cluster.type === "MENU_INTERACTION") {
        const tokens = cluster.tokens.filter(t => t.action === "click");
        if (tokens.length >= 2) {
            const lastToken = tokens[tokens.length - 1];
            if (lastToken.locator) {
                const words = lastToken.locator.value.split(/[-_]/);
                return words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
            }
        }
        return "performMenuAction";
    }

    // For form submission
    if (cluster.type === "FORM_SUBMISSION") {
        return "fillForm";
    }

    // For authentication
    if (cluster.type === "AUTHENTICATION") {
        return "login";
    }

    // Default: Use first action verb
    const firstAction = cluster.tokens[0];
    if (firstAction.locator) {
        const actionVerb = firstAction.action === "click" ? "click" : firstAction.action;
        const targetName = firstAction.locator.value
            .split(/[-_]/)
            .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))
            .join("");
        return `${actionVerb}${targetName.charAt(0).toUpperCase() + targetName.slice(1)}`;
    }

    return "performAction";
}

/**
 * Generate a method from a cluster of actions
 */
export function generateMethod(
    cluster: Cluster,
    mappings: SelectorMapping[],
    style: StyleVector
): string {
    const methodName = generateMethodName(cluster);
    const lines: string[] = [];

    lines.push(`  public async ${methodName}() {`);

    for (const token of cluster.tokens) {
        if (token.isAssertion) continue; // Skip assertions in method body

        if (token.locator) {
            // Find the mapping for this locator
            const mapping = mappings.find(m =>
                m.selector.value === token.locator?.value &&
                m.selector.type === token.locator?.type
            );

            if (mapping) {
                const propRef = `this.${mapping.targetProperty}`;
                const locatorRef = style.locatorStyle === "WrapperClass"
                    ? `${propRef}.controlLocator`
                    : propRef;

                switch (token.action) {
                    case "click":
                        lines.push(`    await ${locatorRef}.click();`);
                        break;
                    case "fill":
                    case "type":
                        if (token.value) {
                            lines.push(`    await ${locatorRef}.fill('${token.value}');`);
                        }
                        break;
                    case "textContent":
                        lines.push(`    return await ${locatorRef}.textContent();`);
                        break;
                    default:
                        lines.push(`    await ${locatorRef}.${token.action}();`);
                }
            }
        }
    }

    lines.push("  }");
    return lines.join("\n");
}

// ============================================================================
// Page Object Modification
// ============================================================================

/**
 * Group mappings by target Page Object class
 */
export function groupMappingsByClass(
    mappings: SelectorMapping[]
): Map<string, SelectorMapping[]> {
    const groups = new Map<string, SelectorMapping[]>();

    for (const mapping of mappings) {
        if (!mapping.isNewProperty) continue; // Skip existing properties

        const existing = groups.get(mapping.targetClass) || [];
        existing.push(mapping);
        groups.set(mapping.targetClass, existing);
    }

    return groups;
}

/**
 * Generate Page Object modifications
 */
export function generatePageObjectMods(
    mappings: SelectorMapping[],
    clusters: Cluster[],
    pageObjectIndex: PageObjectIndex,
    style: StyleVector
): PageObjectMod[] {
    const mods: PageObjectMod[] = [];
    const groupedMappings = groupMappingsByClass(mappings);

    for (const [className, classMappings] of groupedMappings) {
        const poData = pageObjectIndex[className];
        if (!poData) continue;

        // Generate new properties
        const newProperties = classMappings.map(m => generateProperty(m, style));

        // Generate methods for relevant clusters
        const newMethods: string[] = [];
        for (const cluster of clusters) {
            // Check if this cluster's tokens map to this class
            const clusterMapsToClass = cluster.tokens.some(token => {
                if (!token.locator) return false;
                const mapping = mappings.find(m =>
                    m.selector.value === token.locator?.value
                );
                return mapping?.targetClass === className;
            });

            if (clusterMapsToClass && cluster.type === "MENU_INTERACTION") {
                newMethods.push(generateMethod(cluster, mappings, style));
            }
        }

        mods.push({
            filePath: poData.filePath,
            className,
            newProperties,
            newMethods,
            insertionPoint: findInsertionPoint(poData),
        });
    }

    return mods;
}

/**
 * Find the line number to insert new properties (after last property, before methods)
 */
function findInsertionPoint(poData: { locators: { lineNumber: number }[]; methods: { lineNumber: number }[] }): number {
    // After last locator
    if (poData.locators.length > 0) {
        const maxLocatorLine = Math.max(...poData.locators.map(l => l.lineNumber));
        return maxLocatorLine + 1;
    }

    // Before first method if no locators
    if (poData.methods.length > 0) {
        const minMethodLine = Math.min(...poData.methods.map(m => m.lineNumber));
        return minMethodLine;
    }

    // Default: line 10 (after class declaration and constructor)
    return 10;
}

// ============================================================================
// Test File Generation
// ============================================================================

/**
 * Generate test file from clusters and mappings
 */
export function generateTestFile(
    clusters: Cluster[],
    mappings: SelectorMapping[],
    fixtureRegistry: FixtureRegistry,
    testName: string,
    outputPath: string,
    style: StyleVector
): GeneratedTest {
    // Collect required fixtures
    const requiredFixtures = new Set<string>();

    for (const mapping of mappings) {
        const fixtureEntry = Object.entries(fixtureRegistry).find(
            ([, entry]) => entry.className === mapping.targetClass
        );
        if (fixtureEntry) {
            requiredFixtures.add(fixtureEntry[0]);
        }
    }

    const fixturesArray = Array.from(requiredFixtures);

    // Generate imports
    const imports = [
        "import { test } from '../pages/fixture'",
        "import { expect } from '@playwright/test'",
    ];

    // Check if TestTags is used
    const hasTestTags = style.importStatements.some(i => i.includes("testTags"));
    if (hasTestTags) {
        imports.push("import { TestTags } from '../utils/testTags'");
    }

    // Generate test body
    const lines: string[] = [];

    lines.push(...imports);
    lines.push("");
    lines.push(`test.describe('${testName}', () => {`);
    lines.push("");

    // Add test data constants
    lines.push("  // Test data");
    lines.push("  const EMAIL = process.env.TEST_EMAIL || 'test@example.com';");
    lines.push("  const PASSWORD = process.env.TEST_PASSWORD || 'password123';");
    lines.push("");

    // Generate test
    const fixtureParams = fixturesArray.join(", ");
    const tagPart = hasTestTags ? ", { tag: [TestTags.UI_SMOKE_TEST] }" : "";

    lines.push(`  test('QA Test: ${testName}'${tagPart}, async ({ ${fixtureParams} }) => {`);

    // Generate steps from clusters
    for (const cluster of clusters) {
        lines.push(`    // ${cluster.intent}`);

        for (const token of cluster.tokens) {
            const line = generateTestLine(token, mappings, fixtureRegistry, style);
            if (line) {
                lines.push(`    ${line}`);
            }
        }

        lines.push("");
    }

    lines.push("  });");
    lines.push("});");
    lines.push("");

    return {
        filePath: outputPath,
        content: lines.join("\n"),
        fixtures: fixturesArray,
        imports,
    };
}

/**
 * Generate a single test line from an action token
 */
function generateTestLine(
    token: ActionToken,
    mappings: SelectorMapping[],
    fixtureRegistry: FixtureRegistry,
    style: StyleVector
): string | null {
    // Handle navigation
    if (token.action === "goto") {
        return `await page.goto('${token.value}');`;
    }

    if (token.action === "waitForURL") {
        return `await page.waitForURL('${token.value}');`;
    }

    // Handle assertions
    if (token.isAssertion && token.locator) {
        const mapping = mappings.find(m =>
            m.selector.value === token.locator?.value
        );

        if (mapping) {
            const fixture = findFixtureForClass(mapping.targetClass, fixtureRegistry);
            const propRef = style.locatorStyle === "WrapperClass"
                ? `${fixture}.${mapping.targetProperty}.controlLocator`
                : `${fixture}.${mapping.targetProperty}`;

            return `await expect(${propRef}).toBeVisible();`;
        }
    }

    // Handle regular actions
    if (token.locator) {
        const mapping = mappings.find(m =>
            m.selector.value === token.locator?.value &&
            m.selector.type === token.locator?.type
        );

        if (mapping) {
            const fixture = findFixtureForClass(mapping.targetClass, fixtureRegistry);
            const propRef = style.locatorStyle === "WrapperClass"
                ? `${fixture}.${mapping.targetProperty}`
                : `${fixture}.${mapping.targetProperty}`;

            switch (token.action) {
                case "click":
                    if (style.locatorStyle === "WrapperClass") {
                        return `await ${fixture}.click(${propRef});`;
                    }
                    return `await ${propRef}.click();`;

                case "fill":
                case "type":
                    if (style.locatorStyle === "WrapperClass") {
                        return `await ${fixture}.type(${propRef}, '${token.value || ''}');`;
                    }
                    return `await ${propRef}.fill('${token.value || ''}');`;

                default:
                    return `await ${propRef}.${token.action}();`;
            }
        }
    }

    // Handle variable-based actions
    if (token.actor !== "page" && token.actor) {
        return `await ${token.actor}.${token.action}();`;
    }

    return null;
}

/**
 * Find fixture name for a class
 */
function findFixtureForClass(
    className: string,
    fixtureRegistry: FixtureRegistry
): string {
    for (const [fixtureName, entry] of Object.entries(fixtureRegistry)) {
        if (entry.className === className) {
            return fixtureName;
        }
    }

    // Default: lowercase class name
    return className.charAt(0).toLowerCase() + className.slice(1);
}

// ============================================================================
// Import Generation
// ============================================================================

/**
 * Generate required import statements for modified Page Objects
 */
export function generateImports(
    mods: PageObjectMod[],
    style: StyleVector
): Map<string, string[]> {
    const importsMap = new Map<string, string[]>();

    for (const mod of mods) {
        const imports: string[] = [];

        // If using wrapper class, ensure import is present
        if (style.locatorStyle === "WrapperClass" && style.wrapperClassName) {
            imports.push(`import { ${style.wrapperClassName} } from './controls/${style.wrapperClassName.toLowerCase()}'`);
        }

        importsMap.set(mod.filePath, imports);
    }

    return importsMap;
}

// ============================================================================
// Code Application
// ============================================================================

/**
 * Apply modifications to a Page Object file content
 */
export function applyPageObjectMod(
    fileContent: string,
    mod: PageObjectMod
): string {
    const lines = fileContent.split("\n");

    // Find insertion point (after last property, before methods)
    let insertIndex = mod.insertionPoint - 1;

    // Ensure we don't insert in the middle of something
    while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
        insertIndex++;
    }

    // Prepare new content
    const newContent: string[] = [];

    // Add new properties
    if (mod.newProperties.length > 0) {
        newContent.push("");
        newContent.push("  // Auto-generated properties");
        newContent.push(...mod.newProperties);
    }

    // Add new methods
    if (mod.newMethods.length > 0) {
        newContent.push("");
        newContent.push("  // Auto-generated methods");
        newContent.push(...mod.newMethods);
    }

    // Insert new content
    lines.splice(insertIndex, 0, ...newContent);

    return lines.join("\n");
}
