import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

/**
 * Result of JSON parsing
 */
export interface JsonParseResult {
  content: any;
  jsonDocument?: jsonc.Node;
  errors?: jsonc.ParseError[];
}

/**
 * JSON Parser with AST support
 */
export class JsonParser {
  /**
   * Parse JSON with AST information
   * @param document The document to parse
   * @returns The parse result with AST
   */
  async parse(document: vscode.TextDocument): Promise<JsonParseResult | null> {
    try {
      const text = document.getText();
      const errors: jsonc.ParseError[] = [];
      
      // Parse with jsonc-parser to get the AST
      const jsonDocument = jsonc.parseTree(text, errors, { disallowComments: false });
      
      if (!jsonDocument) {
        return null;
      }
      
      // Parse the content as well
      const content = jsonc.parse(text, errors, { disallowComments: false });
      
      return {
        content,
        jsonDocument,
        errors
      };
    } catch (error) {
      console.error('JSON parse error:', error);
      return null;
    }
  }
  
  /**
   * Find a node by path in the AST
   * @param root The root node
   * @param path The path to find
   * @returns The node at the path or undefined
   */
  findNodeByPath(root: jsonc.Node | undefined, path: string[]): jsonc.Node | undefined {
    if (!root || path.length === 0) {
      return root;
    }
    
    let currentNode = root;
    
    for (const segment of path) {
      if (!currentNode.children) {
        return undefined;
      }
      
      // Find the property with the segment name
      let found = false;
      
      for (const child of currentNode.children) {
        if (child.type === 'property' && 
            child.children && 
            child.children.length > 0 && 
            child.children[0].value === segment) {
          // Found the property, now move to its value (the second child)
          if (child.children.length > 1) {
            currentNode = child.children[1];
            found = true;
            break;
          }
        }
      }
      
      if (!found) {
        return undefined;
      }
    }
    
    return currentNode;
  }
  
  /**
   * Get the range for a node
   * @param document The document
   * @param node The node
   * @returns The range in the document
   */
  getNodeRange(document: vscode.TextDocument, node: jsonc.Node): vscode.Range {
    const start = document.positionAt(node.offset);
    const end = document.positionAt(node.offset + node.length);
    return new vscode.Range(start, end);
  }
}