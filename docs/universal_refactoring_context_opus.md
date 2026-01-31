# Universal Automated Refactoring Strategy (OPUS Edition)
## From Raw Playwright Codegen Output to Repository-Ready Page Object Model Code

**Document Purpose:** This is the definitive, micro-level technical specification for building an AI-powered autonomous agent that transforms raw, procedural Playwright code (typically generated via `npx playwright codegen`) into production-ready, POM-structured code that seamlessly integrates with any existing test automation repository.

**Target Audience:** This document is designed to be consumed by both human developers and Large Language Models (LLMs) being used as the "brain" of an autonomous refactoring agent.

---

## Table of Contents
1.  [System Architecture Overview](#1-system-architecture-overview)
2.  [Phase I: Repository Reconnaissance](#2-phase-i-repository-reconnaissance-contextingest)
3.  [Phase II: Input Parsing](#3-phase-ii-input-parsing-inputparse)
4.  [Phase III: The Mapping Engine](#4-phase-iii-the-mapping-engine-logicmap)
5.  [Phase IV: Code Synthesis](#5-phase-iv-code-synthesis-gencode)
6.  [Phase V: Verification Loop](#6-phase-v-verification-loop-runtimeverify)
7.  [Data Structures & Schemas](#7-data-structures--schemas)

---

## 1. System Architecture Overview

The autonomous refactoring agent operates as a **5-phase pipeline**. Each phase has distinct responsibilities, inputs, and outputs. The agent uses a combination of **file system tools** (for deterministic operations) and **LLM reasoning** (for semantic understanding and code generation).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTONOMOUS REFACTORING PIPELINE                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                │
│  │ RAW CODEGEN  │──▶│  PHASE I:    │──▶│  PHASE II:   │                │
│  │ INPUT FILE   │   │  RECON       │   │  PARSE       │                │
│  └──────────────┘   └──────────────┘   └──────────────┘                │
│                            │                   │                        │
│                            ▼                   ▼                        │
│                     ┌──────────────────────────────────┐                │
│                     │        KNOWLEDGE GRAPH           │                │
│                     │   (Repo Context + Raw Trace)     │                │
│                     └──────────────────────────────────┘                │
│                                    │                                    │
│                                    ▼                                    │
│                          ┌──────────────┐                               │
│                          │  PHASE III:  │                               │
│                          │  MAP         │                               │
│                          └──────────────┘                               │
│                                    │                                    │
│                                    ▼                                    │
│                          ┌──────────────┐                               │
│                          │  PHASE IV:   │                               │
│                          │  GENERATE    │                               │
│                          └──────────────┘                               │
│                                    │                                    │
│                                    ▼                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                │
│  │  MODIFIED    │◀──│  PHASE V:    │◀──│  NEW TEST    │                │
│  │  PAGE OBJECTS│   │  VERIFY      │   │  FILE        │                │
│  └──────────────┘   └──────────────┘   └──────────────┘                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core Principles:
1.  **Zero Assumptions:** The agent must NOT assume any specific repo structure. It must discover everything.
2.  **Chameleon Code:** Generated code MUST match the existing style of the target repository perfectly.
3.  **Self-Healing:** If generated code causes test failures, the agent must analyze the error and self-correct.

---

## 2. Phase I: Repository Reconnaissance (`context.ingest`)

**Goal:** Build a complete mental model of the target repository's architecture, conventions, and coding patterns WITHOUT any prior knowledge.

### 2.1 Structural Discovery Algorithm

**Executor:** File System Tools (`list_dir`, `find_by_name`)

**Input:** Root path of the target repository.

**Algorithm (Pseudo-code):**
```python
def discover_structure(repo_root: str) -> RepoContext:
    context = RepoContext()

    # Step 1: Root-level scan
    root_contents = list_dir(repo_root, depth=1)
    
    # Step 2: Identify Page Object directory
    pom_candidates = ["pages", "page-objects", "po", "src/pages", "lib/pages"]
    for candidate in pom_candidates:
        if exists(repo_root / candidate):
            context.page_object_dir = candidate
            context.repo_type = "STANDARD_POM"
            break
    
    # Step 3: Identify Test directory
    test_candidates = ["tests", "test", "e2e", "spec", "src/tests"]
    for candidate in test_candidates:
        if exists(repo_root / candidate):
            context.test_dir = candidate
            break
    
    # Step 4: Check for Fixture pattern
    fixture_patterns = ["**/fixture.ts", "**/fixtures.ts", "**/test.extend.ts"]
    fixture_files = find_by_name(repo_root, patterns=fixture_patterns)
    if fixture_files:
        context.uses_fixtures = True
        context.fixture_file = fixture_files[0]
    
    # Step 5: Check config for additional context
    config_file = repo_root / "playwright.config.ts"
    if exists(config_file):
        context.config = parse_playwright_config(config_file)
        context.test_dir = context.config.get("testDir", context.test_dir)
    
    return context
```

**Output Data Structure:**
```typescript
interface RepoContext {
  repoType: "STANDARD_POM" | "COMPONENT_BASED" | "UNKNOWN";
  pageObjectDir: string;      // e.g., "pages/"
  testDir: string;            // e.g., "tests/"
  usesFixtures: boolean;
  fixtureFile: string | null; // e.g., "pages/fixture.ts"
  config: PlaywrightConfig;
  baseClass: string | null;   // e.g., "BasePage" if inheritance is used
}
```

### 2.2 Syntax Pattern Recognition (Static Analysis)

**Executor:** File System Tools (`view_file`, `view_file_outline`) + LLM Reasoning

**Goal:** Detect the exact coding patterns used in the repository so generated code matches perfectly.

**Algorithm:**
1.  **Sample Selection:** Read the first 3 files in `pageObjectDir` (sorted alphabetically).
2.  **Pattern Extraction:** Use RegEx and AST analysis to detect:

| Pattern Type | Detection Method | Example Output |
| ------------ | ---------------- | -------------- |
| Locator Style | RegEx: `(readonly\|public\|private)\s+\w+\s*[=:]\s*(new\s+\w+\()?\s*this\.page\.(locator\|getBy)` | `"WrapperClass"` or `"Native"` |
| Wrapper Class | Extract class name from `new ClassName(...)` | `"WebControl"` |
| Base Class | RegEx: `class\s+\w+\s+extends\s+(\w+)` | `"BasePage"` |
| Method Style | Analyze method bodies: Are they single actions? Do they chain? | `"Atomic"` or `"Fluent"` |
| Visibility | Check if properties are `public`, `private`, or `readonly` | `"public"` |

**Concrete RegEx Patterns:**
```javascript
// Detect wrapper class usage
const WRAPPER_PATTERN = /(\w+)\s*=\s*new\s+(\w+)\s*\(\s*this\.page\.(getBy\w+|locator)\s*\(/;
// Groups: [1] = property name, [2] = wrapper class name

// Detect native locator
const NATIVE_PATTERN = /(readonly|public|private)\s+(\w+)\s*=\s*this\.page\.(getBy\w+|locator)\s*\(/;
// Groups: [1] = visibility, [2] = property name

// Detect base class
const BASE_CLASS_PATTERN = /class\s+(\w+)\s+extends\s+(\w+)/;
// Groups: [1] = class name, [2] = base class name
```

**Output Data Structure:**
```typescript
interface StyleVector {
  locatorStyle: "WrapperClass" | "Native" | "Getter";
  wrapperClassName: string | null;  // e.g., "WebControl"
  baseClassName: string | null;     // e.g., "BasePage"
  propertyVisibility: "public" | "readonly" | "private";
  methodStyle: "Atomic" | "Fluent" | "Void";
  importStatements: string[];       // Required imports
}
```

### 2.3 Page Object Indexing (Symbol Table Construction)

**Executor:** File System Tools (`view_file_outline`, `grep_search`) + LLM Parsing

**Goal:** Build a complete index of all existing Page Objects and their members.

**Algorithm:**
1.  List all `.ts` files in `pageObjectDir`.
2.  For each file:
    a.  Use `view_file_outline` to get class structure.
    b.  Extract all properties (locators) and methods.
    c.  For each locator property, extract the selector string.

**Output Data Structure:**
```typescript
interface PageObjectIndex {
  [className: string]: {
    filePath: string;
    baseClass: string | null;
    locators: LocatorEntry[];
    methods: MethodEntry[];
    fixtureAlias: string;  // e.g., "loginPage" for "LoginPage"
  }
}

interface LocatorEntry {
  propertyName: string;     // e.g., "signInBtn"
  selectorType: "testid" | "role" | "css" | "xpath" | "text";
  selectorValue: string;    // e.g., "sign-in-button"
  rawCode: string;          // e.g., 'this.page.getByTestId("sign-in-button")'
}

interface MethodEntry {
  methodName: string;
  parameters: string[];
  returnType: string;
  description: string;      // LLM-generated semantic description
}
```

### 2.4 Fixture Registry Parsing

**Executor:** File System Tools (`view_file`) + LLM Parsing

**Goal:** Understand how Page Objects are instantiated and injected into tests.

**Algorithm:**
1.  Read `fixtureFile`.
2.  Extract all fixture definitions from `test.extend({...})` block.
3.  Map fixture name -> class name and instantiation pattern.

**Concrete Example:**
```typescript
// Input: pages/fixture.ts
export const test = base.extend<{ loginPage: LoginPage; layoutPage: LayoutPage }>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  layoutPage: async ({ page }, use) => {
    await use(new LayoutPage(page));
  },
});

// Output: FixtureRegistry
{
  "loginPage": { className: "LoginPage", instantiation: "new LoginPage(page)" },
  "layoutPage": { className: "LayoutPage", instantiation: "new LayoutPage(page)" }
}
```

---

## 3. Phase II: Input Parsing (`input.parse`)

**Goal:** Transform the raw, linear Playwright codegen output into a structured "Semantic Action Chain" that can be reasoned about.

### 3.1 Tokenization (Line-by-Line AST Extraction)

**Executor:** LLM Parsing (TypeScript AST knowledge)

**Input:** Raw `test.spec.ts` file content.

**Algorithm:**
For each line of code that is a Playwright action:
1.  Identify the **Actor** (usually `page`).
2.  Identify the **Action** (e.g., `fill`, `click`, `goto`).
3.  Identify the **Target** (the locator).
4.  Identify the **Value** (for `fill`, `type`).

**Tokenization Patterns:**
```javascript
// Pattern 1: page.action(selector)
const ACTION_PATTERN_1 = /await\s+page\.(click|fill|type|check|press)\s*\(\s*(.*?)\s*(?:,\s*['"`](.*?)['"`])?\s*\)/;

// Pattern 2: page.locator(...).action()
const ACTION_PATTERN_2 = /await\s+page\.(locator|getBy\w+)\s*\((.*?)\)\.(click|fill|type|check|press)\s*\((.*?)\)/;

// Pattern 3: const variable = page.locator(...)
const VARIABLE_PATTERN = /const\s+(\w+)\s*=\s*page\.(locator|getBy\w+)\s*\((.*?)\)/;

// Pattern 4: expect(locator).toBeVisible()
const ASSERTION_PATTERN = /await\s+expect\s*\((.*?)\)\.(toBeVisible|toHaveText|toHaveValue|toContainText)\s*\((.*?)\)/;
```

**Output Data Structure (Single Token):**
```typescript
interface ActionToken {
  lineNumber: number;
  rawCode: string;
  actor: "page" | string;     // variable name if using stored locator
  action: "click" | "fill" | "type" | "goto" | "waitForURL" | "expect" | ...;
  locator: LocatorInfo;
  value: string | null;       // for fill/type actions
  isAssertion: boolean;
}

interface LocatorInfo {
  type: "testid" | "role" | "css" | "xpath" | "text" | "label" | "placeholder";
  value: string;              // the selector string
  options: Record<string, any>;  // e.g., { name: 'Submit' } for getByRole
  fullExpression: string;     // e.g., "page.getByTestId('submit-btn')"
}
```

### 3.2 Semantic Clustering (Context Windowing)

**Executor:** LLM Reasoning

**Goal:** Group related action tokens into logical clusters based on intent.

**Clustering Heuristics:**

| Cluster Type | Detection Rule | Example |
| ------------ | -------------- | ------- |
| **Navigation** | `goto`, `waitForURL`, `reload` | `[goto('https://...'), waitForURL('**/dashboard')]` |
| **Authentication** | Actions on `email`, `password`, `signin`, `login` selectors | `[fill(email), fill(password), click(signin)]` |
| **Form Submission** | Consecutive `fill`/`type` followed by `click` on `submit`/`button` | `[fill(name), fill(address), click(submit)]` |
| **Menu Interaction** | `click` on `menu`/`dropdown` followed by `click` on child item | `[click(profile-menu), click(settings)]` |
| **Assertion** | `expect` calls | `[expect(toast).toBeVisible()]` |

**Clustering Algorithm (Pseudo-code):**
```python
def cluster_tokens(tokens: List[ActionToken]) -> List[Cluster]:
    clusters = []
    current_cluster = Cluster(type="UNKNOWN")
    
    for i, token in enumerate(tokens):
        # Rule 1: Navigation always starts a new cluster
        if token.action in ["goto", "reload"]:
            if current_cluster.tokens:
                clusters.append(current_cluster)
            current_cluster = Cluster(type="NAVIGATION", tokens=[token])
            continue
        
        # Rule 2: Check for auth pattern
        if is_auth_related(token.locator):
            if current_cluster.type != "AUTHENTICATION":
                if current_cluster.tokens:
                    clusters.append(current_cluster)
                current_cluster = Cluster(type="AUTHENTICATION")
            current_cluster.tokens.append(token)
            continue
        
        # Rule 3: Assertions belong to the previous cluster
        if token.isAssertion:
            current_cluster.tokens.append(token)
            current_cluster.assertions.append(token)
            continue
        
        # Rule 4: Menu patterns (click -> click in sequence)
        if token.action == "click" and i > 0:
            prev_token = tokens[i - 1]
            if prev_token.action == "click" and is_container_element(prev_token.locator):
                current_cluster.type = "MENU_INTERACTION"
                current_cluster.tokens.append(token)
                continue
        
        # Default: Add to current cluster
        current_cluster.tokens.append(token)
    
    if current_cluster.tokens:
        clusters.append(current_cluster)
    
    return clusters

def is_auth_related(locator: LocatorInfo) -> bool:
    auth_keywords = ["email", "password", "login", "signin", "username", "auth"]
    return any(kw in locator.value.lower() for kw in auth_keywords)

def is_container_element(locator: LocatorInfo) -> bool:
    container_keywords = ["menu", "dropdown", "modal", "dialog", "popup", "profile"]
    return any(kw in locator.value.lower() for kw in container_keywords)
```

**Output Data Structure:**
```typescript
interface Cluster {
  type: "NAVIGATION" | "AUTHENTICATION" | "FORM_SUBMISSION" | "MENU_INTERACTION" | "VERIFICATION" | "GENERIC";
  tokens: ActionToken[];
  assertions: ActionToken[];
  intent: string;  // LLM-generated human-readable intent, e.g., "Login to the application"
}
```

### 3.3 Variable and Constant Resolution

**Executor:** LLM Parsing

**Goal:** Identify constants, variables, and test data that should NOT be moved to Page Objects.

**Rules:**
1.  If a `const` is a **primitive value** (string, number, boolean) -> **Test Data** (stays in test file).
2.  If a `const` is a **Locator** (`page.locator(...)`) -> **Candidate for Page Object property**.
3.  If a `const` is used as a **parameter to fill/type** -> **Test Data**.

**Example Analysis:**
```typescript
// Input
const EMAIL = 'user@example.com';          // -> TEST DATA
const EXPECTED_TITLE = 'Welcome';          // -> TEST DATA
const submitBtn = page.getByRole('button', { name: 'Submit' }); // -> PAGE OBJECT PROPERTY
await page.fill('#email', EMAIL);          // EMAIL is TEST DATA
```

---

## 4. Phase III: The Mapping Engine (`logic.map`)

**Goal:** Determine which Page Object each orphan selector belongs to.

### 4.1 The "Direct Hit" Algorithm (Exact Match)

**Executor:** Tool (`grep_search`)

**Logic:**
For each selector $S$ extracted from the raw code:
1.  Search all files in `pageObjectDir` for the exact selector string.
2.  If found -> Map $S$ to the existing property.

**Example:**
```
Input Selector: 'user-profile-dropdown'
grep_search(path="pages/", query="user-profile-dropdown")
Result: Found in pages/layoutPage.ts:12 -> Property: userProfileBtn
```

### 4.2 The "Anchor" Algorithm (Parent-Child Inference)

**Executor:** LLM Reasoning + Tool (`grep_search`)

**Concept:** If action A on element $P$ is immediately followed by action B on element $S$, and $P$ already exists in PageObject $X$, then $S$ should also be in $X$.

**Algorithm:**
```python
def anchor_inference(token_S: ActionToken, token_P: ActionToken, page_object_index: PageObjectIndex) -> str | None:
    """
    Returns the name of the Page Object that S should belong to, 
    based on its relationship to P.
    """
    # Step 1: Find where P is defined
    p_selector = token_P.locator.value
    for class_name, po_data in page_object_index.items():
        for locator in po_data.locators:
            if locator.selectorValue == p_selector:
                # P is defined in this Page Object
                return class_name
    
    return None  # P is also an orphan
```

### 4.3 Semantic Vector Scoring (The "Brain" Algorithm)

**Executor:** LLM Reasoning (Embedding-based or Keyword-based)

**Concept:** Match the semantic "intent" of an orphan selector to the "responsibility profile" of each Page Object.

**Algorithm:**

**Step 1: Generate Page Object Responsibility Profiles**
For each Page Object class, analyze its properties and methods to generate a list of responsibility keywords.

```python
def generate_responsibility_profile(po_data: PageObjectData) -> List[str]:
    keywords = []
    
    # From class name
    class_words = camel_to_words(po_data.className)  # "LoginPage" -> ["login", "page"]
    keywords.extend(class_words)
    
    # From property names
    for locator in po_data.locators:
        prop_words = camel_to_words(locator.propertyName)  # "signInBtn" -> ["sign", "in", "btn"]
        keywords.extend(prop_words)
    
    # From method names
    for method in po_data.methods:
        method_words = camel_to_words(method.methodName)  # "loginToSaas" -> ["login", "to", "saas"]
        keywords.extend(method_words)
    
    return list(set(keywords))  # Deduplicate
```

**Example Profiles:**
```
LoginPage: [login, auth, email, password, signin, username, credentials, saas]
LayoutPage: [layout, header, footer, nav, menu, profile, logout, sidebar, theme]
DashboardPage: [dashboard, widget, chart, stats, welcome, home, overview]
```

**Step 2: Extract Keywords from Orphan Selector**
```python
def extract_selector_keywords(locator: LocatorInfo) -> List[str]:
    # Split by common delimiters
    raw = locator.value  # e.g., "theme-switcher"
    words = re.split(r'[-_\s]', raw)  # -> ["theme", "switcher"]
    
    # Also consider role/label if available
    if locator.type == "role" and "name" in locator.options:
        words.extend(locator.options["name"].lower().split())
    
    return words
```

**Step 3: Score Each Candidate**
```python
def score_candidate(orphan_keywords: List[str], po_profile: List[str]) -> float:
    """
    Simple Jaccard-like overlap score.
    More sophisticated: Use embedding cosine similarity.
    """
    overlap = set(orphan_keywords) & set(po_profile)
    total = set(orphan_keywords) | set(po_profile)
    return len(overlap) / len(total) if total else 0.0
```

**Step 4: Select Winner**
```python
def map_orphan(orphan: LocatorInfo, page_object_index: PageObjectIndex) -> str:
    orphan_keywords = extract_selector_keywords(orphan)
    
    scores = {}
    for class_name, po_data in page_object_index.items():
        profile = generate_responsibility_profile(po_data)
        scores[class_name] = score_candidate(orphan_keywords, profile)
    
    # Return the class with the highest score
    winner = max(scores, key=scores.get)
    return winner
```

### 4.4 Tie-Breaking Rules

When scores are close (within 0.1), apply these tie-breakers in order:

1.  **Hierarchy Rule:** Prefer the Page Object that contains the "Anchor" element (parent).
2.  **Locality Rule:** Prefer Page Objects whose filename matches the current test file's context (e.g., `settings.test.ts` prefers `SettingsPage`).
3.  **Generic Fallback:** Prefer `LayoutPage` or `BasePage` for global elements (header, footer, nav).

---

## 5. Phase IV: Code Synthesis (`gen.code`)

**Goal:** Generate syntactically correct, style-matched code.

### 5.1 The "Chameleon" Property Generator

**Executor:** LLM Code Generation

**Input:**
*   `orphan`: The selector to convert.
*   `targetClass`: The Page Object to add it to.
*   `styleVector`: The coding style detected in Phase I.

**Algorithm:**
```python
def generate_property(orphan: LocatorInfo, target_class: str, style: StyleVector) -> str:
    # Step 1: Generate human-readable property name
    property_name = to_camel_case(orphan.value)  # "theme-switcher" -> "themeSwitcher"
    
    # Step 2: Generate locator expression
    locator_expr = generate_locator_expression(orphan)
    
    # Step 3: Apply style
    if style.locatorStyle == "WrapperClass":
        human_name = to_title_case(orphan.value)  # "Theme Switcher"
        return f'{style.propertyVisibility} {property_name} = new {style.wrapperClassName}(this.page.{locator_expr}, \'{human_name}\')'
    elif style.locatorStyle == "Native":
        return f'{style.propertyVisibility} {property_name} = this.page.{locator_expr}'
    elif style.locatorStyle == "Getter":
        return f'get {property_name}() {{ return this.page.{locator_expr}; }}'

def generate_locator_expression(locator: LocatorInfo) -> str:
    if locator.type == "testid":
        return f"getByTestId('{locator.value}')"
    elif locator.type == "role":
        opts = ", ".join(f"{k}: '{v}'" for k, v in locator.options.items())
        return f"getByRole('{locator.value}', {{ {opts} }})"
    elif locator.type == "css":
        return f"locator('{locator.value}')"
    # ... handle other types
```

### 5.2 Method Construction

**Executor:** LLM Code Generation

**When to Create a Method:**
1.  When multiple actions form a logical sequence (e.g., click menu -> click item).
2.  When the raw code performs a high-level action (e.g., "toggle theme").

**Method Naming Heuristic:**
*   `click` + `[element]` -> `click[Element]()` (for single actions)
*   Multi-step sequence -> Use LLM to generate a verb-noun name (e.g., `toggleTheme`, `navigateToSettings`).

**Example:**
```typescript
// Input Tokens: [click(profile), click(theme-switcher)]
// Generated Method:
public async toggleTheme() {
    await this.click(this.userProfileBtn);  // Open menu
    await this.click(this.themeSwitcher);   // Click toggle
}
```

### 5.3 Test File Reconstruction

**Executor:** LLM Code Generation

**Algorithm:**
1.  **Collect Required Fixtures:** List all Page Objects used in the refactored action chain.
2.  **Generate Test Signature:**
    ```typescript
    test('Test Name', { tag: [TestTags.UI_SMOKE_TEST] }, async ({ loginPage, layoutPage }) => {
        // ...
    });
    ```
3.  **Replace Raw Actions:**
    *   `page.fill('#email', EMAIL)` -> `await loginPage.type(loginPage.emailInput, EMAIL)`
    *   `page.click('[data-testid="theme"]')` -> `await layoutPage.toggleTheme()`
4.  **Preserve Assertions:** Keep `expect(...)` calls, but update locators to use Page Object properties.

### 5.4 Import Statement Generation

**Executor:** Deterministic (Tool)

Scan the generated code for used classes/fixtures and generate imports.

```typescript
import { test } from '../pages/fixture';
import { expect } from '@playwright/test';
import { TestTags } from '../utils/testTags';
```

---

## 6. Phase V: Verification Loop (`runtime.verify`)

**Goal:** Automatically detect and fix runtime failures.

### 6.1 Error Classification

| Error Type | Detection Pattern | Root Cause | Auto-Fix Strategy |
| ---------- | ----------------- | ---------- | ----------------- |
| **Element Not Found** | `locator.click: Timeout waiting for element` | Selector changed, page not loaded | Add `waitFor()`, verify selector |
| **Element Intercepted** | `locator.click: Element is intercepting pointer events` | Overlay, modal, or backdrop blocking | Add `waitForSelector` to dismiss, or `force: true` |
| **Stale Element** | `Element is stale` | Page navigated, element re-rendered | Re-query the element |
| **Assertion Failed** | `expect(received).toBe(expected)` | Logic error, timing issue | Add `expect.poll()` for eventual consistency |

### 6.2 The Self-Correction Algorithm

**Executor:** Tool (Test Runner Feedback) + LLM Reasoning

```python
def verify_and_fix(test_file: str, max_retries: int = 3) -> bool:
    for attempt in range(max_retries):
        result = run_test(test_file)
        
        if result.passed:
            return True
        
        error = parse_error(result.stderr)
        fix = determine_fix(error)
        
        if fix:
            apply_fix(fix)
        else:
            return False  # Cannot auto-fix
    
    return False

def determine_fix(error: ErrorInfo) -> Fix | None:
    if error.type == "ElementNotFound":
        return Fix(
            type="ADD_WAIT",
            code=f"await {error.locator}.waitFor({{ state: 'visible' }})"
        )
    elif error.type == "ElementIntercepted":
        # Check if a backdrop is blocking
        if "MuiBackdrop" in error.message or "overlay" in error.message:
            return Fix(
                type="MODIFY_CLICK",
                code=f"await {error.locator}.click({{ force: true }})"
            )
        # Or wait for backdrop to disappear
        return Fix(
            type="ADD_WAIT",
            code=f"await page.waitForSelector('.MuiBackdrop-root', {{ state: 'hidden' }})"
        )
    # ... more error types
    
    return None
```

---

## 7. Data Structures & Schemas

### 7.1 Complete Knowledge Graph Schema

```typescript
interface KnowledgeGraph {
  // From Phase I
  repoContext: RepoContext;
  styleVector: StyleVector;
  pageObjectIndex: PageObjectIndex;
  fixtureRegistry: FixtureRegistry;
  
  // From Phase II
  rawTokens: ActionToken[];
  clusters: Cluster[];
  testData: TestData[];
  
  // From Phase III
  mappings: SelectorMapping[];
  
  // Generated Artifacts
  pageObjectModifications: PageObjectMod[];
  generatedTestFile: string;
}

interface SelectorMapping {
  selector: LocatorInfo;
  targetClass: string;
  targetProperty: string;  // New or existing property name
  isNewProperty: boolean;
  confidence: number;      // 0.0 - 1.0
}

interface PageObjectMod {
  filePath: string;
  className: string;
  newProperties: string[];   // Lines of code to insert
  newMethods: string[];      // Lines of code to insert
  insertionPoint: number;    // Line number
}
```

### 7.2 LLM Prompt Template (For Mapping Phase)

```
You are an expert test automation engineer. Given the following context:

## Repository Structure:
{repoContextJSON}

## Existing Page Objects and their members:
{pageObjectIndexJSON}

## Orphan Selector to Map:
{orphanSelectorJSON}

## Preceding Action (Anchor):
{anchorTokenJSON}

---

Determine which Page Object this orphan selector belongs to.

RULES:
1. If the anchor element is already in a Page Object, prefer that same object.
2. Consider the semantic meaning of the selector (e.g., "theme" -> Layout, "email" -> Login).
3. Global elements (header, nav, footer) belong to LayoutPage or BasePage.

OUTPUT FORMAT (JSON):
{
  "targetClass": "ClassName",
  "reasoning": "Explanation of why this mapping was chosen",
  "confidence": 0.85
}
```

---

## END OF OPUS SPECIFICATION

This document should be used as the primary context for any LLM tasked with building or executing the autonomous refactoring agent.
