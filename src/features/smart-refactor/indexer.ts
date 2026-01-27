import { Project, SyntaxKind, ClassDeclaration } from "ts-morph";
import { glob } from "glob";
import * as path from "path";
import { PageObjectIndex, PageObjectInfo, MethodSignature } from "./types";

export class POMIndexer {
  private project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Scans the directory for Page Object Model files and builds an index.
   * A file is considered a POM if it exports a class ending in "Page".
   */
  async index(rootDir: string): Promise<PageObjectIndex> {
    const index: PageObjectIndex = {};
    
    // Pattern to find likely POM files. Adjust as needed.
    // Searching for .ts files in src/
    const files = await glob("**/*.ts", { cwd: rootDir, absolute: true });

    for (const filePath of files) {
      // optimization: skip checking node_modules or dist
      if (filePath.includes("node_modules") || filePath.includes("dist")) continue;

      try {
        const sourceFile = this.project.addSourceFileAtPath(filePath);
        
        // Find classes exported from the file
        const classes = sourceFile.getClasses();
        
        for (const cls of classes) {
          if (this.isPageObject(cls)) {
            const info = this.extractPageInfo(cls, filePath);
            index[info.className] = info;
          }
        }
      } catch (error) {
        console.warn(`Failed to parse file: ${filePath}`, error);
      }
    }

    return index;
  }

  private isPageObject(cls: ClassDeclaration): boolean {
    const name = cls.getName();
    // heuristic: class name ends with "Page" (e.g. LoginPage, DashboardPage)
    // or file path suggests it's a page object (handled by glob usually, but class check is safer)
    return !!name && name.endsWith("Page");
  }

  private extractPageInfo(cls: ClassDeclaration, filePath: string): PageObjectInfo {
    const className = cls.getName()!;
    const methods: MethodSignature[] = [];
    const locators: Set<string> = new Set();

    // Extract public methods
    for (const method of cls.getMethods()) {
        // Only include public methods that are not constructor
        if (method.getScope() !== "private" && method.getScope() !== "protected") {
             methods.push({
                name: method.getName(),
                parameters: method.getParameters().map(p => {
                    const type = p.getTypeNode() ? p.getTypeNode()!.getText() : "any";
                    return `${p.getName()}: ${type}`;
                }),
                returnType: method.getReturnTypeNode() ? method.getReturnTypeNode()!.getText() : "Promise<void>"
            });
        }
    }

    // Extract string literals that look like selectors
    // This is a heuristic: finding string literals inside the class
    cls.getDescendantsOfKind(SyntaxKind.StringLiteral).forEach(literal => {
        const text = literal.getLiteralText();
        // heuristic: selectors often contain special chars or are short-ish
        // We filter out very long strings (likely content) or very short ones
        if (this.isSelectorCandidate(text)) {
            locators.add(text);
        }
    });
    
    // Also look for template expressions that might be simple selectors `div.foo`
    cls.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral).forEach(literal => {
         const text = literal.getLiteralText();
         if (this.isSelectorCandidate(text)) {
            locators.add(text);
        }
    });

    return {
      className,
      filePath,
      methods,
      locators: Array.from(locators)
    };
  }

  private isSelectorCandidate(text: string): boolean {
    if (text.length < 2 || text.length > 100) return false;
    // Exclude common non-selector strings
    if (["GET", "POST", "PUT", "DELETE"].includes(text)) return false;
    // Selectors often have CSS symbols . # [ > or are data-testid
    const hasSelectorChars = /[.#\[\]>]/.test(text) || text.includes("text=") || text.includes("data-testid");
    // Or it's a simple word (tag name) like "button", "input" - harder to distinguish from content
    // For now, let's be permissive but exclude obvious sentences
    if (text.includes(" ")) {
        // if it has spaces, it should have selector syntax to be valid
        return hasSelectorChars;
    }
    return true;
  }
}
