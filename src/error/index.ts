import * as vscode from 'vscode';
import { Logger } from '../logging';

/**
 * Base error class for the extension
 */
export class ExtensionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExtensionError';
    }
}

/**
 * Error class for validation errors
 */
export class ValidationError extends ExtensionError {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Error class for Azure API errors
 */
export class AzureApiError extends ExtensionError {
    constructor(message: string, public readonly originalError?: any) {
        super(message);
        this.name = 'AzureApiError';
    }
}

/**
 * Error class for file system errors
 */
export class FileSystemError extends ExtensionError {
    constructor(message: string, public readonly path?: string) {
        super(message);
        this.name = 'FileSystemError';
    }
}

/**
 * Error class for configuration errors
 */
export class ConfigurationError extends ExtensionError {
    constructor(message: string, public readonly setting?: string) {
        super(message);
        this.name = 'ConfigurationError';
    }
}

/**
 * Error handler class for the extension
 */
export class ErrorHandler {
    private static logger = Logger.getInstance();
    
    /**
     * Handle an error
     * @param error The error to handle
     * @param userMessage Optional user-friendly message to show
     */
    public static handleError(error: any, userMessage?: string): void {
        // Log the error
        this.logger.error(userMessage || error.message, error);
        
        // Determine the error type and handle accordingly
        if (error instanceof ValidationError) {
            this.handleValidationError(error, userMessage);
        } else if (error instanceof AzureApiError) {
            this.handleAzureApiError(error, userMessage);
        } else if (error instanceof FileSystemError) {
            this.handleFileSystemError(error, userMessage);
        } else if (error instanceof ConfigurationError) {
            this.handleConfigurationError(error, userMessage);
        } else {
            this.handleGenericError(error, userMessage);
        }
    }
    
    /**
     * Handle a validation error
     * @param error The validation error
     * @param userMessage Optional user-friendly message to show
     */
    private static handleValidationError(error: ValidationError, userMessage?: string): void {
        vscode.window.showWarningMessage(userMessage || `Validation error: ${error.message}`);
    }
    
    /**
     * Handle an Azure API error
     * @param error The Azure API error
     * @param userMessage Optional user-friendly message to show
     */
    private static handleAzureApiError(error: AzureApiError, userMessage?: string): void {
        const showDetails = vscode.workspace.getConfiguration('epacman').get('errorHandling.showDetailedErrors', false);
        
        if (showDetails) {
            vscode.window.showErrorMessage(
                userMessage || `Azure API error: ${error.message}. See output channel for details.`,
                'Show Logs'
            ).then(selection => {
                if (selection === 'Show Logs') {
                    this.logger.show();
                }
            });
        } else {
            vscode.window.showErrorMessage(userMessage || `Azure API error: ${error.message}`);
        }
    }
    
    /**
     * Handle a file system error
     * @param error The file system error
     * @param userMessage Optional user-friendly message to show
     */
    private static handleFileSystemError(error: FileSystemError, userMessage?: string): void {
        vscode.window.showErrorMessage(userMessage || `File system error: ${error.message}`);
    }
    
    /**
     * Handle a configuration error
     * @param error The configuration error
     * @param userMessage Optional user-friendly message to show
     */
    private static handleConfigurationError(error: ConfigurationError, userMessage?: string): void {
        vscode.window.showErrorMessage(
            userMessage || `Configuration error: ${error.message}`,
            'Open Settings'
        ).then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'epacman');
            }
        });
    }
    
    /**
     * Handle a generic error
     * @param error The error
     * @param userMessage Optional user-friendly message to show
     */
    private static handleGenericError(error: any, userMessage?: string): void {
        const showDetails = vscode.workspace.getConfiguration('epacman').get('errorHandling.showDetailedErrors', false);
        
        if (showDetails) {
            vscode.window.showErrorMessage(
                userMessage || `An error occurred: ${error.message}. See output channel for details.`,
                'Show Logs'
            ).then(selection => {
                if (selection === 'Show Logs') {
                    this.logger.show();
                }
            });
        } else {
            vscode.window.showErrorMessage(userMessage || `An error occurred: ${error.message}`);
        }
    }
}

/**
 * Retry an operation with exponential backoff
 * @param operation The operation to retry
 * @param maxRetries Maximum number of retries
 * @param retryDelay Initial delay in milliseconds
 * @returns The result of the operation
 * @throws The last error encountered
 */
export async function retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 1000
): Promise<T> {
    const logger = Logger.getInstance();
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            
            if (isTransientError(error) && attempt < maxRetries) {
                const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
                logger.warn(`Transient error, retrying in ${delay}ms`, { attempt, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break;
            }
        }
    }
    
    throw lastError;
}

/**
 * Determine if an error is transient
 * @param error The error to check
 * @returns True if the error is transient, false otherwise
 */
function isTransientError(error: any): boolean {
    // Logic to determine if an error is transient
    return error.code === 'ETIMEDOUT' || 
           error.code === 'ECONNRESET' || 
           error.statusCode === 429; // Too Many Requests
}