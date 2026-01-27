import { PageObjectIndex, PageObjectInfo, RelevantContext } from "./types";

export class ContextMatcher {
  /**
   * Matches raw code against the Page Object Index to find relevant pages.
   */
  match(rawCode: string, index: PageObjectIndex): RelevantContext {
    const rawSelectors = this.extractSelectors(rawCode);
    const relevantPagesMap = new Map<string, PageObjectInfo>();
    const matchedSelectors: Record<string, string> = {};

    for (const selector of rawSelectors) {
      for (const className in index) {
        const page = index[className];
        if (page.locators.includes(selector)) {
          relevantPagesMap.set(className, page);
          matchedSelectors[selector] = className;
          // Optimization: If found, maybe stop looking for this selector? 
          // But it might be on multiple pages. For now, first match wins or last match?
          // Let's stick with finding all relevant pages.
        }
      }
    }

    // Fallback: If no selectors matched, but the user mentioned a page name in comments or filename?
    // For now, strict selector matching.

    return {
      relevantPages: Array.from(relevantPagesMap.values()),
      matchedSelectors
    };
  }

  private extractSelectors(code: string): string[] {
    const selectors = new Set<string>();
    
    // Regex to find string literals '...' or "..." or `...`
    // This is naive but works for standard codegen output
    const regex = /['"`](.*?)['"`]/g;
    let match;
    while ((match = regex.exec(code)) !== null) {
      const text = match[1];
      if (this.isValidSelector(text)) {
        selectors.add(text);
      }
    }
    return Array.from(selectors);
  }

  private isValidSelector(text: string): boolean {
    if (text.length < 2 || text.length > 100) return false;
    // Exclude common non-selector strings found in code
    if (["http", "https", "GET", "POST", "text/css"].some(prefix => text.startsWith(prefix))) return false;
    
    // Heuristic: Must look like a selector
    const hasSelectorChars = /[.#\[\]>]/.test(text) || text.includes("text=") || text.includes("data-testid") || text.includes("role=");
    if (text.includes(" ")) {
      return hasSelectorChars;
    }
    return true; // Single words can be IDs or tags
  }
}
