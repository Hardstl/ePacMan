import * as vscode from 'vscode';
import { JsonParseResult } from './json-parser';
import { SchemaManager } from './schema-manager';

/**
 * Validation severity levels
 */
export enum ValidationSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3
}

/**
 * Validation issue
 */
export interface ValidationIssue {
    code: string;
    message: string;
    severity: ValidationSeverity;
    range: vscode.Range;
    source: string;
    rule: string;
    data?: any;
}

/**
 * Validation result
 */
export interface ValidationResult {
    documentUri: vscode.Uri;
    issues: ValidationIssue[];
    valid: boolean;
}

/**
 * Validation context passed to validation rules
 */
export interface ValidationContext {
    parseResult: JsonParseResult | null;
    schemaManager: SchemaManager;
    documentUri: vscode.Uri;
    documentType: string;
    workspaceUri?: vscode.Uri;
}

/**
 * Validation rule
 */
export interface ValidationRule<T> {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    severity: ValidationSeverity;
    validate(document: vscode.TextDocument, content: T, context: ValidationContext): Promise<ValidationIssue[]>;
    canFix?(issue: ValidationIssue): boolean;
    fix?(document: vscode.TextDocument, issue: ValidationIssue): Promise<vscode.WorkspaceEdit | undefined>;
}

/**
 * Abstract validator base class
 */
export abstract class AbstractValidator {
    private rules: ValidationRule<any>[] = [];
    private documentType: string;
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor(documentType: string) {
        this.documentType = documentType;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(`epacman-${documentType}`);
    }

    /**
     * Register a validation rule
     */
    protected registerRule(rule: ValidationRule<any>): void {
        this.rules.push(rule);
    }

    /**
     * Get all registered rules
     */
    getRules(): ValidationRule<any>[] {
        return this.rules;
    }

    /**
     * Get document type
     */
    getDocumentType(): string {
        return this.documentType;
    }

    /**
     * Parse document for validation
     */
    abstract parseDocument(document: vscode.TextDocument): Promise<JsonParseResult | null>;

    /**
     * Check if this validator can validate the document
     */
    abstract canValidate(document: vscode.TextDocument): Promise<boolean>;

    /**
     * Determine document type from parse result
     */
    protected abstract determineDocumentType(parseResult: any): string;

    /**
     * Validate a document
     */
    async validate(document: vscode.TextDocument, schemaManager: SchemaManager): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        try {
            // Parse the document
            const parseResult = await this.parseDocument(document);
            if (!parseResult) {
                return [];
            }

            // Determine document type
            const documentType = this.determineDocumentType(parseResult);

            // Create validation context
            const context: ValidationContext = {
                parseResult,
                schemaManager,
                documentUri: document.uri,
                documentType,
                workspaceUri: vscode.workspace.getWorkspaceFolder(document.uri)?.uri
            };

            // Run all enabled rules
            for (const rule of this.rules) {
                if (!rule.enabled) continue;

                try {
                    const ruleIssues = await rule.validate(document, parseResult.content, context);
                    issues.push(...ruleIssues);
                } catch (error) {
                    console.error(`Error running validation rule ${rule.id}:`, error);
                }
            }

            // Update diagnostics
            this.updateDiagnostics(document, issues);
        } catch (error) {
            console.error('Error validating document:', error);
        }

        return issues;
    }

    /**
     * Update diagnostics for the document
     * @param document The document
     * @param issues The validation issues
     */
    private updateDiagnostics(document: vscode.TextDocument, issues: ValidationIssue[]): void {
        // Convert validation issues to diagnostics
        const diagnostics = issues.map(issue => {
            const diagnostic = new vscode.Diagnostic(
                issue.range,
                issue.message,
                this.severityToDiagnosticSeverity(issue.severity)
            );

            diagnostic.code = issue.code;
            diagnostic.source = issue.source;
            diagnostic.relatedInformation = [];

            return diagnostic;
        });

        // Set diagnostics
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Convert ValidationSeverity to vscode.DiagnosticSeverity
     * @param severity The validation severity
     * @returns The diagnostic severity
     */
    private severityToDiagnosticSeverity(severity: ValidationSeverity): vscode.DiagnosticSeverity {
        switch (severity) {
            case ValidationSeverity.Error:
                return vscode.DiagnosticSeverity.Error;
            case ValidationSeverity.Warning:
                return vscode.DiagnosticSeverity.Warning;
            case ValidationSeverity.Information:
                return vscode.DiagnosticSeverity.Information;
            case ValidationSeverity.Hint:
                return vscode.DiagnosticSeverity.Hint;
            default:
                return vscode.DiagnosticSeverity.Error;
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}