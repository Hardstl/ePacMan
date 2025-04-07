import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { Logger } from '../logging';
import { FileSystemError } from '../error';
export * from './document-utils';

/**
 * Utility functions for the extension
 */

const logger = Logger.getInstance();

/**
 * Get the workspace folder for a file
 * @param uri The file URI
 * @returns The workspace folder or undefined
 */
export function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
}

/**
 * Find files in the workspace
 * @param pattern The glob pattern
 * @param exclude The exclude pattern
 * @returns The file URIs
 */
export async function findFiles(pattern: string, exclude?: string): Promise<vscode.Uri[]> {
    return await vscode.workspace.findFiles(pattern, exclude);
}

/**
 * Read a file as text
 * @param uri The file URI
 * @returns The file content
 */
export async function readFile(uri: vscode.Uri): Promise<string> {
    try {
        const content = await fs.readFile(uri.fsPath, 'utf-8');
        return content;
    } catch (error: any) {
        throw new FileSystemError(`Failed to read file: ${error.message}`, uri.fsPath);
    }
}

/**
 * Write text to a file
 * @param uri The file URI
 * @param content The content to write
 */
export async function writeFile(uri: vscode.Uri, content: string): Promise<void> {
    try {
        // Ensure the directory exists
        const dirname = path.dirname(uri.fsPath);
        await fs.ensureDir(dirname);
        
        // Write the file
        await fs.writeFile(uri.fsPath, content, 'utf-8');
    } catch (error: any) {
        throw new FileSystemError(`Failed to write file: ${error.message}`, uri.fsPath);
    }
}

/**
 * Parse JSON from a file
 * @param uri The file URI
 * @returns The parsed JSON
 */
export async function parseJsonFile(uri: vscode.Uri): Promise<any> {
    try {
        const content = await readFile(uri);
        return JSON.parse(content);
    } catch (error: any) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in file ${uri.fsPath}: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Get the relative path from the workspace root
 * @param uri The file URI
 * @returns The relative path
 */
export function getRelativePath(uri: vscode.Uri): string {
    const workspaceFolder = getWorkspaceFolder(uri);
    if (workspaceFolder) {
        return path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    }
    return uri.fsPath;
}

/**
 * Open a file in the editor
 * @param uri The file URI
 */
export async function openFileInEditor(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.window.showTextDocument(uri);
    } catch (error: any) {
        throw new Error(`Failed to open file in editor: ${error.message}`);
    }
}

/**
 * Show an information message with options
 * @param message The message
 * @param options The options
 * @returns The selected option or undefined
 */
export async function showInformationMessage(message: string, ...options: string[]): Promise<string | undefined> {
    return await vscode.window.showInformationMessage(message, ...options);
}

/**
 * Show an error message with options
 * @param message The message
 * @param options The options
 * @returns The selected option or undefined
 */
export async function showErrorMessage(message: string, ...options: string[]): Promise<string | undefined> {
    return await vscode.window.showErrorMessage(message, ...options);
}

/**
 * Show a warning message with options
 * @param message The message
 * @param options The options
 * @returns The selected option or undefined
 */
export async function showWarningMessage(message: string, ...options: string[]): Promise<string | undefined> {
    return await vscode.window.showWarningMessage(message, ...options);
}