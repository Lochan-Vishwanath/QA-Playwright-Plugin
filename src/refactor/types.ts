/**
 * E2E Refactoring Pipeline - Type Definitions
 * Based on the Universal Automated Refactoring Strategy (OPUS Edition)
 */

// ============================================================================
// Phase I: Repository Reconnaissance Types
// ============================================================================

/**
 * Repository structure context discovered during reconnaissance
 */
export interface RepoContext {
    repoRoot: string;
    repoType: "STANDARD_POM" | "COMPONENT_BASED" | "UNKNOWN";
    pageObjectDir: string | null;
    testDir: string | null;
    usesFixtures: boolean;
    fixtureFile: string | null;
    configFile: string | null;
    baseClass: string | null;
}

/**
 * Coding style patterns detected in the repository
 */
export interface StyleVector {
    locatorStyle: "WrapperClass" | "Native" | "Getter";
    wrapperClassName: string | null;
    baseClassName: string | null;
    propertyVisibility: "public" | "readonly" | "private";
    methodStyle: "Atomic" | "Fluent" | "Void";
    importStatements: string[];
}

/**
 * Individual locator entry in a Page Object
 */
export interface LocatorEntry {
    propertyName: string;
    selectorType: "testid" | "role" | "css" | "xpath" | "text" | "label" | "placeholder";
    selectorValue: string;
    selectorOptions?: Record<string, any>;
    rawCode: string;
    lineNumber: number;
}

/**
 * Method entry in a Page Object
 */
export interface MethodEntry {
    methodName: string;
    parameters: string[];
    returnType: string;
    body?: string;
    lineNumber: number;
    description?: string;
}

/**
 * Complete Page Object index entry
 */
export interface PageObjectData {
    className: string;
    filePath: string;
    baseClass: string | null;
    locators: LocatorEntry[];
    methods: MethodEntry[];
    fixtureAlias: string | null;
    imports: string[];
}

/**
 * Complete index of all Page Objects in repository
 */
export interface PageObjectIndex {
    [className: string]: PageObjectData;
}

/**
 * Fixture registry mapping fixture names to classes
 */
export interface FixtureEntry {
    className: string;
    filePath: string;
    instantiation: string;
}

export interface FixtureRegistry {
    [fixtureName: string]: FixtureEntry;
}

// ============================================================================
// Phase II: Input Parsing Types
// ============================================================================

/**
 * Information about a locator extracted from raw code
 */
export interface LocatorInfo {
    type: "testid" | "role" | "css" | "xpath" | "text" | "label" | "placeholder";
    value: string;
    options: Record<string, any>;
    fullExpression: string;
}

/**
 * Tokenized action from raw Playwright code
 */
export interface ActionToken {
    lineNumber: number;
    rawCode: string;
    actor: "page" | string;
    action: "click" | "fill" | "type" | "goto" | "waitForURL" | "expect" | "textContent" |
    "check" | "press" | "hover" | "dblclick" | "selectOption" | "assign" | "other";
    locator: LocatorInfo | null;
    value: string | null;
    isAssertion: boolean;
    variableName?: string;
}

/**
 * Semantic cluster of related actions
 */
export interface Cluster {
    id: string;
    type: "NAVIGATION" | "AUTHENTICATION" | "FORM_SUBMISSION" | "MENU_INTERACTION" | "VERIFICATION" | "GENERIC";
    intent: string;
    tokens: ActionToken[];
    assertions: ActionToken[];
}

/**
 * Test data extracted from raw code
 */
export interface TestDataItem {
    variableName: string;
    value: string;
    type: "string" | "number" | "boolean";
    usage: "fill" | "type" | "assertion" | "other";
}

// ============================================================================
// Phase III: Mapping Types
// ============================================================================

/**
 * Mapping of an orphan selector to a Page Object
 */
export interface SelectorMapping {
    selector: LocatorInfo;
    targetClass: string;
    targetProperty: string;
    isNewProperty: boolean;
    confidence: number;
    reasoning?: string;
}

// ============================================================================
// Phase IV: Code Generation Types
// ============================================================================

/**
 * Page Object modification to be applied
 */
export interface PageObjectMod {
    filePath: string;
    className: string;
    newProperties: string[];
    newMethods: string[];
    insertionPoint: number;
}

/**
 * Generated test file content
 */
export interface GeneratedTest {
    filePath: string;
    content: string;
    fixtures: string[];
    imports: string[];
}

// ============================================================================
// Phase V: Verification Types
// ============================================================================

/**
 * Test execution result
 */
export interface TestResult {
    passed: boolean;
    stdout: string;
    stderr: string;
    duration: number;
}

/**
 * Classified error from test failure
 */
export interface ClassifiedError {
    type: "ElementNotFound" | "ElementIntercepted" | "StaleElement" | "AssertionFailed" | "Timeout" | "Unknown";
    message: string;
    locator?: string;
    suggestion?: string;
}

/**
 * Fix to apply for a classified error
 */
export interface FixAction {
    type: "ADD_WAIT" | "MODIFY_CLICK" | "RE_QUERY" | "ADD_POLL" | "NONE";
    code: string;
    targetFile: string;
    targetLine?: number;
}

// ============================================================================
// Complete Knowledge Graph
// ============================================================================

/**
 * Complete knowledge graph built during refactoring
 */
export interface KnowledgeGraph {
    // Phase I
    repoContext: RepoContext;
    styleVector: StyleVector;
    pageObjectIndex: PageObjectIndex;
    fixtureRegistry: FixtureRegistry;

    // Phase II
    rawCode: string;
    rawTokens: ActionToken[];
    clusters: Cluster[];
    testData: TestDataItem[];

    // Phase III
    mappings: SelectorMapping[];

    // Phase IV
    pageObjectMods: PageObjectMod[];
    generatedTest: GeneratedTest | null;
}

// ============================================================================
// CLI & Runner Types
// ============================================================================

/**
 * Extended CLI options for refactoring mode
 */
export interface RefactorOptions {
    instruction: string;
    outputDir: string;
    repoPath: string;
    baseUrl?: string;
    timeout?: number;
    verbose?: boolean;
    dryRun?: boolean;
}

/**
 * Refactoring result
 */
export interface RefactorResult {
    success: boolean;
    rawScriptPath: string;
    modifiedFiles: string[];
    generatedTestPath: string | null;
    errors: string[];
    knowledge?: KnowledgeGraph;
}
