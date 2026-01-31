/**
 * Phase III: The Mapping Engine
 * 
 * Determine which Page Object each orphan selector belongs to using
 * direct hit search, anchor inference, and semantic scoring.
 */

import * as fs from "fs";
import * as path from "path";
import type {
    LocatorInfo,
    ActionToken,
    PageObjectIndex,
    PageObjectData,
    SelectorMapping,
} from "./types";

// ============================================================================
// Direct Hit Search
// ============================================================================

/**
 * Search for exact selector match in existing Page Objects
 */
export function directHitSearch(
    selector: LocatorInfo,
    pageObjectIndex: PageObjectIndex
): SelectorMapping | null {
    const selectorValue = selector.value;

    for (const [className, poData] of Object.entries(pageObjectIndex)) {
        for (const locator of poData.locators) {
            // Exact match on selector value
            if (locator.selectorValue === selectorValue) {
                return {
                    selector,
                    targetClass: className,
                    targetProperty: locator.propertyName,
                    isNewProperty: false,
                    confidence: 1.0,
                    reasoning: `Direct hit: Selector "${selectorValue}" found in ${className}.${locator.propertyName}`,
                };
            }

            // Match by role + name options
            if (selector.type === "role" && locator.selectorType === "role") {
                if (
                    selector.value === locator.selectorValue &&
                    selector.options?.name === locator.selectorOptions?.name
                ) {
                    return {
                        selector,
                        targetClass: className,
                        targetProperty: locator.propertyName,
                        isNewProperty: false,
                        confidence: 1.0,
                        reasoning: `Direct hit: Role selector "${selectorValue}" with name "${selector.options?.name}" found in ${className}.${locator.propertyName}`,
                    };
                }
            }
        }
    }

    return null;
}

// ============================================================================
// Anchor Inference
// ============================================================================

/**
 * Use the preceding action's locator (anchor) to infer the Page Object for orphan selector
 */
export function anchorInference(
    orphanToken: ActionToken,
    anchorToken: ActionToken | null,
    pageObjectIndex: PageObjectIndex
): string | null {
    if (!anchorToken || !anchorToken.locator) {
        return null;
    }

    const anchorSelector = anchorToken.locator.value;

    // Find which Page Object contains the anchor
    for (const [className, poData] of Object.entries(pageObjectIndex)) {
        for (const locator of poData.locators) {
            if (locator.selectorValue === anchorSelector) {
                // Anchor found - orphan likely belongs to same Page Object
                return className;
            }
        }
    }

    return null;
}

// ============================================================================
// Semantic Scoring
// ============================================================================

/**
 * Convert camelCase or PascalCase to word list
 */
function camelToWords(str: string): string[] {
    // Handle common prefixes/suffixes
    const cleaned = str
        .replace(/Page$/, "")
        .replace(/Btn$/, "button")
        .replace(/Txtbx$/, "textbox")
        .replace(/Lbl$/, "label");

    return cleaned
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 0);
}

/**
 * Generate responsibility profile (keywords) for a Page Object
 */
export function generateResponsibilityProfile(poData: PageObjectData): string[] {
    const keywords: string[] = [];

    // From class name
    keywords.push(...camelToWords(poData.className));

    // From property names
    for (const locator of poData.locators) {
        keywords.push(...camelToWords(locator.propertyName));
        // Also include selector value words
        keywords.push(...locator.selectorValue.toLowerCase().split(/[-_]/));
    }

    // From method names
    for (const method of poData.methods) {
        keywords.push(...camelToWords(method.methodName));
    }

    // Deduplicate
    return [...new Set(keywords)];
}

/**
 * Extract keywords from a selector
 */
export function extractSelectorKeywords(locator: LocatorInfo): string[] {
    const words: string[] = [];

    // Split selector value by common delimiters
    const selectorWords = locator.value.toLowerCase().split(/[-_\s]/);
    words.push(...selectorWords.filter(w => w.length > 0));

    // Include role name if available
    if (locator.type === "role" && locator.options?.name) {
        words.push(...locator.options.name.toLowerCase().split(/\s+/));
    }

    return words;
}

/**
 * Calculate overlap score between two keyword sets (Jaccard-like)
 */
export function calculateOverlapScore(keywords1: string[], keywords2: string[]): number {
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);

    const intersection = [...set1].filter(w => set2.has(w));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.length / union.size : 0;
}

/**
 * Score each Page Object candidate for an orphan selector
 */
export function semanticScoring(
    orphan: LocatorInfo,
    pageObjectIndex: PageObjectIndex,
    anchorClass: string | null = null
): { className: string; score: number; reasoning: string }[] {
    const orphanKeywords = extractSelectorKeywords(orphan);
    const scores: { className: string; score: number; reasoning: string }[] = [];

    for (const [className, poData] of Object.entries(pageObjectIndex)) {
        const profile = generateResponsibilityProfile(poData);
        let score = calculateOverlapScore(orphanKeywords, profile);
        let reasoning = `Base score: ${score.toFixed(2)} (keyword overlap)`;

        // Anchor boost: +0.5 if anchor is in this Page Object
        if (anchorClass === className) {
            score += 0.5;
            reasoning += ` + 0.5 anchor boost`;
        }

        // Layout/Base page boost for global elements
        const globalKeywords = ["header", "nav", "footer", "sidebar", "theme", "profile", "menu", "logout"];
        const isGlobalElement = orphanKeywords.some(kw => globalKeywords.includes(kw));
        const isLayoutPage = className.toLowerCase().includes("layout") || className.toLowerCase().includes("base");

        if (isGlobalElement && isLayoutPage) {
            score += 0.2;
            reasoning += ` + 0.2 global element boost`;
        }

        scores.push({ className, score, reasoning });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
}

// ============================================================================
// Tie-Breaking Rules
// ============================================================================

/**
 * Apply tie-breaking rules when scores are close
 */
function applyTieBreakers(
    candidates: { className: string; score: number; reasoning: string }[],
    orphan: LocatorInfo,
    pageObjectIndex: PageObjectIndex
): string {
    if (candidates.length === 0) {
        return "UnknownPage"; // Fallback for new page object creation
    }

    const top = candidates[0];
    const second = candidates[1];

    // If clear winner (margin > 0.1), return it
    if (!second || top.score - second.score > 0.1) {
        return top.className;
    }

    // Tie-breaker 1: Prefer Layout for global elements
    const globalKeywords = ["header", "nav", "footer", "sidebar", "theme", "profile", "menu"];
    const orphanKeywords = extractSelectorKeywords(orphan);

    if (orphanKeywords.some(kw => globalKeywords.includes(kw))) {
        const layoutCandidate = candidates.find(c =>
            c.className.toLowerCase().includes("layout")
        );
        if (layoutCandidate) {
            return layoutCandidate.className;
        }
    }

    // Tie-breaker 2: Prefer more specific page (more locators)
    const topLocators = pageObjectIndex[top.className]?.locators.length || 0;
    const secondLocators = pageObjectIndex[second.className]?.locators.length || 0;

    if (topLocators > secondLocators) {
        return top.className;
    }
    if (secondLocators > topLocators) {
        return second.className;
    }

    // Default to highest score
    return top.className;
}

// ============================================================================
// Property Name Generation
// ============================================================================

/**
 * Generate a property name from a selector
 */
export function generatePropertyName(locator: LocatorInfo): string {
    let baseName = locator.value;

    // Use role name if available
    if (locator.type === "role" && locator.options?.name) {
        baseName = locator.options.name;
    }

    // Convert to camelCase
    const words = baseName
        .toLowerCase()
        .split(/[-_\s]+/)
        .filter(w => w.length > 0);

    if (words.length === 0) {
        return "element";
    }

    // CamelCase: first word lowercase, rest capitalized
    return words
        .map((word, i) => i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
}

// ============================================================================
// Main Mapping Function
// ============================================================================

/**
 * Map an orphan selector to a Page Object
 */
export function mapOrphan(
    orphan: LocatorInfo,
    tokens: ActionToken[],
    tokenIndex: number,
    pageObjectIndex: PageObjectIndex
): SelectorMapping {
    // Step 1: Direct hit search
    const directHit = directHitSearch(orphan, pageObjectIndex);
    if (directHit) {
        return directHit;
    }

    // Step 2: Anchor inference
    const anchorToken = tokenIndex > 0 ? tokens[tokenIndex - 1] : null;
    const anchorClass = anchorInference(tokens[tokenIndex], anchorToken, pageObjectIndex);

    // Step 3: Semantic scoring
    const scores = semanticScoring(orphan, pageObjectIndex, anchorClass);

    // Step 4: Apply tie-breakers and select winner
    const targetClass = applyTieBreakers(scores, orphan, pageObjectIndex);
    const winningScore = scores.find(s => s.className === targetClass);

    // Generate property name for new property
    const propertyName = generatePropertyName(orphan);

    return {
        selector: orphan,
        targetClass,
        targetProperty: propertyName,
        isNewProperty: true,
        confidence: winningScore?.score || 0.5,
        reasoning: winningScore?.reasoning || "Default mapping (no match found)",
    };
}

/**
 * Map all orphan selectors from parsed tokens
 */
export function mapAllOrphans(
    tokens: ActionToken[],
    pageObjectIndex: PageObjectIndex
): SelectorMapping[] {
    const mappings: SelectorMapping[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (!token.locator) continue;

        // Skip if we've already processed this selector
        const selectorKey = `${token.locator.type}:${token.locator.value}:${JSON.stringify(token.locator.options)}`;
        if (seen.has(selectorKey)) continue;
        seen.add(selectorKey);

        const mapping = mapOrphan(token.locator, tokens, i, pageObjectIndex);
        mappings.push(mapping);
    }

    return mappings;
}

/**
 * Get orphan selectors (selectors not in any Page Object)
 */
export function getOrphanSelectors(
    mappings: SelectorMapping[]
): SelectorMapping[] {
    return mappings.filter(m => m.isNewProperty);
}

/**
 * Get existing selectors (already in Page Objects)
 */
export function getExistingSelectors(
    mappings: SelectorMapping[]
): SelectorMapping[] {
    return mappings.filter(m => !m.isNewProperty);
}
