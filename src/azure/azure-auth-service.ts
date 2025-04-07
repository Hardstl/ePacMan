import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../logging';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Service for handling Azure authentication
 */
export class AzureAuthService {
    private logger = Logger.getInstance();

    constructor() {
        this.logger.debug('AzureAuthService initialized');
    }

    /**
     * Checks if the user is logged in to Azure PowerShell
     * @returns Promise resolving to true if logged in, false otherwise
     */
    public async isLoggedIn(): Promise<boolean> {
        try {
            // Use the bundled script to get Azure context info
            const contextInfo = await this.getAzureContextInfo();
            // If we got valid context info, the user is logged in
            return !!contextInfo;
        } catch (error) {
            this.logger.error(`Error checking login status: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    /**
     * Gets information about the current Azure context (tenant and subscription)
     * @returns Promise resolving to context info or undefined if not logged in
     */
    public async getAzureContextInfo(): Promise<{ tenantId: string; subscriptionId: string; subscriptionName: string } | undefined> {
        try {
            this.logger.info('Getting Azure context information');
            
            // Get the extension path to locate our bundled scripts
            const extensionPath = vscode.extensions.getExtension('hardstahl.epacman')?.extensionPath;
            if (!extensionPath) {
                throw new Error('Could not determine extension path');
            }
            
            // Build the path to the PowerShell script using path.join for safety
            const scriptPath = path.join(extensionPath, 'scripts', 'powershell', 'Get-AzureContext.ps1');
            this.logger.debug(`Using script: ${scriptPath}`);
            
            // Try to use PowerShell Core (pwsh) first, fall back to Windows PowerShell if not available
            // This provides better cross-platform support
            let psCommand: string;
            
            // Sanitize the script path to prevent command injection
            const sanitizedScriptPath = this.sanitizePathForPowerShell(scriptPath);
            
            // Check if PowerShell Core is available
            let powershellExe = 'powershell';
            let isPwshAvailable = false;
            
            try {
                // Use a synchronous check first
                const { execSync } = require('child_process');
                execSync('pwsh -Command "exit"', { stdio: 'ignore' });
                // If we get here, pwsh is available
                powershellExe = 'pwsh';
                isPwshAvailable = true;
                this.logger.debug('PowerShell Core (pwsh) is available');
            } catch (error) {
                this.logger.debug('PowerShell Core not available, falling back to Windows PowerShell');
            }
            
            // Build command arguments as an array for safer execution
            const args = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', sanitizedScriptPath
            ];
            
            // Construct the command safely
            const command = powershellExe;
            const options = { timeout: 30000 };
            
            this.logger.debug(`Executing PowerShell command: ${command} ${args.join(' ')}`);
            
            // Execute the command with arguments passed separately for safety
            const { stdout, stderr } = await this.executeCommandSafely(command, args, options);
            
            if (stderr) {
                this.logger.warn(`PowerShell stderr output: ${stderr}`);
            }
            
            if (!stdout.trim()) {
                this.logger.info('No Azure context information available');
                return undefined;
            }
            
            try {
                // Look for our context data between markers
                const startMarker = "---AZURE_CONTEXT_START---";
                const endMarker = "---AZURE_CONTEXT_END---";
                
                const startIndex = stdout.indexOf(startMarker);
                const endIndex = stdout.indexOf(endMarker);
                
                if (startIndex === -1 || endIndex === -1) {
                    this.logger.warn('Could not find context markers in output');
                    this.logger.debug(`Raw output: ${stdout}`);
                    return undefined;
                }
                
                // Extract the content between the markers
                const jsonContent = stdout.substring(startIndex + startMarker.length, endIndex).trim();
                this.logger.debug(`Extracted JSON content: ${jsonContent}`);
                
                // Parse the JSON
                const contextInfo = JSON.parse(jsonContent);
                
                // Check if there's an error message in the JSON
                if (contextInfo.error) {
                    if (contextInfo.errorType === "ModuleNotFound") {
                        this.logger.error(`Azure PowerShell module not found: ${contextInfo.error}`);
                        this.logger.info('Please install the Az PowerShell module with:');
                        this.logger.info('powershell -Command "Install-Module -Name Az -Scope CurrentUser -Repository PSGallery -Force"');
                    } else {
                        this.logger.error(`Error in Azure context: ${contextInfo.error}`);
                    }
                    return undefined;
                }
                
                // If the object is empty (no context)
                if (!contextInfo || Object.keys(contextInfo).length === 0) {
                    this.logger.info('No Azure context available (empty object)');
                    return undefined;
                }
                
                // Mask sensitive data in logs
                const maskedTenantId = this.maskString(contextInfo.TenantId);
                const maskedSubId = this.maskString(contextInfo.SubscriptionId);
                this.logger.info(`Current Azure context: Tenant ID: ${maskedTenantId}, Subscription: ${contextInfo.SubscriptionName} (${maskedSubId})`);
                
                return {
                    tenantId: contextInfo.TenantId,
                    subscriptionId: contextInfo.SubscriptionId,
                    subscriptionName: contextInfo.SubscriptionName
                };
            } catch (parseError) {
                this.logger.error(`Error parsing context JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
                this.logger.debug(`Raw stdout: ${stdout.trim()}`);
                return undefined;
            }
        } catch (error) {
            this.logger.error(`Error getting Azure context: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return undefined;
        }
    }


    /**
     * Prompts the user to log in to Azure PowerShell
     * @returns Promise resolving to true if login successful, false otherwise
     */
    public async promptLogin(): Promise<boolean> {
        const loginMessage = 'You need to be logged in to Azure PowerShell to use this feature.';
        const loginAction = 'Log in';
        
        const choice = await vscode.window.showInformationMessage(
            loginMessage,
            loginAction,
            'Cancel'
        );
        
        if (choice === loginAction) {
            // Open a terminal and run the login command
            const terminal = vscode.window.createTerminal('Azure Login');
            terminal.show();
            terminal.sendText('Connect-AzAccount');
            
            // We can't programmatically determine when the login is complete,
            // so we'll just return and let the user retry the operation after logging in
            return true;
        }
        
        return false;
    }

    /**
     * Masks a string for logging purposes, showing only first/last characters
     * @param str The string to mask
     * @returns The masked string
     */
    private maskString(str: string): string {
        if (!str || str.length < 8) {
            return '***';
        }
        const firstChars = str.substring(0, 3);
        const lastChars = str.substring(str.length - 3);
        return `${firstChars}...${lastChars}`;
    }
    
    /**
     * Sanitizes a file path for safe use in PowerShell commands
     * @param filePath The file path to sanitize
     * @returns The sanitized file path
     */
    private sanitizePathForPowerShell(filePath: string): string {
        // Normalize the path to resolve any '..' or '.' segments
        const normalizedPath = path.normalize(filePath);
        
        // Escape any single quotes in the path (PowerShell uses single quotes for strings)
        return normalizedPath.replace(/'/g, "''");
    }
    
    /**
     * Executes a command with arguments safely
     * @param command The command to execute
     * @param args The arguments to pass to the command
     * @param options Options for the command execution
     * @returns Promise resolving to the stdout and stderr of the command
     */
    private async executeCommandSafely(command: string, args: string[], options: any): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const childProcess = spawn(command, args, options);
            
            let stdout = '';
            let stderr = '';
            
            childProcess.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });
            
            childProcess.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });
            
            childProcess.on('close', (code: number) => {
                if (code === 0 || options.ignoreExitCode) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
                }
            });
            
            childProcess.on('error', (err: Error) => {
                reject(err);
            });
            
            // Handle timeout
            if (options.timeout) {
                setTimeout(() => {
                    childProcess.kill();
                    reject(new Error(`Command timed out after ${options.timeout}ms`));
                }, options.timeout);
            }
        });
    }
}