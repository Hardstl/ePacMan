import * as vscode from 'vscode';
import { ErrorHandler } from '../error';
import { ValidationIssue, ValidationSeverity } from './core/validator-framework';

export interface DiagnosticResult {
    uri: vscode.Uri;
    diagnostics: vscode.Diagnostic[];
}

/**
 * Convert validation issues to VS Code diagnostics
 */
export class DiagnosticProvider {
    private static instance: DiagnosticProvider;
    private collection: vscode.DiagnosticCollection;

    private constructor() {
        this.collection = vscode.languages.createDiagnosticCollection('epacman');
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): DiagnosticProvider {
        if (!DiagnosticProvider.instance) {
            DiagnosticProvider.instance = new DiagnosticProvider();
        }
        return DiagnosticProvider.instance;
    }

    /**
     * Update diagnostics for a document
     */
    public updateDiagnostics(document: vscode.TextDocument, issues: ValidationIssue[]): void {
        try {
            const diagnostics = issues.map(issue => this.createDiagnostic(issue));
            this.collection.set(document.uri, diagnostics);
        } catch (error: any) {
            ErrorHandler.handleError('Error updating diagnostics:', error);
        }
    }

    /**
     * Clear diagnostics for a document
     */
    public clearDiagnostics(document: vscode.TextDocument): void {
        this.collection.delete(document.uri);
    }

    /**
     * Clear all diagnostics
     */
    public clearAllDiagnostics(): void {
        this.collection.clear();
    }

    /**
     * Convert a validation issue to a VS Code diagnostic
     */
    private createDiagnostic(issue: ValidationIssue): vscode.Diagnostic {
        // Just use the message without adding source or code (VS Code will do that)
        const diagnostic = new vscode.Diagnostic(
            issue.range,
            issue.message, // Just the message, without any other text
            this.getSeverity(issue.severity)
        );

        // Set these as properties so VS Code will display them correctly
        diagnostic.code = issue.code;
        diagnostic.source = issue.source;

        return diagnostic;
    }

    /**
     * Convert ValidationSeverity to VS Code DiagnosticSeverity
     */
    private getSeverity(severity: ValidationSeverity): vscode.DiagnosticSeverity {
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
     * Dispose of resources
     */
    public dispose(): void {
        this.collection.dispose();
    }
}