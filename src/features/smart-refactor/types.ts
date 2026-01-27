export interface MethodSignature {
  name: string;
  parameters: string[];
  returnType: string;
}

export interface PageObjectInfo {
  className: string;
  filePath: string;
  methods: MethodSignature[];
  locators: string[]; // List of potential selector strings found in the file
}

export interface PageObjectIndex {
  [className: string]: PageObjectInfo;
}

export interface RelevantContext {
  relevantPages: PageObjectInfo[];
  matchedSelectors: Record<string, string>;
}
