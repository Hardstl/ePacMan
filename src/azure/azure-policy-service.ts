import axios from 'axios';
import * as vscode from 'vscode';
import { AzureAuthService } from './azure-auth-service';
import { Logger } from '../logging';
import * as https from 'https';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

/**
 * Represents the types of Azure policies
 */
export enum PolicyType {
    PolicyDefinition = 'policyDefinition',
    PolicyInitiative = 'policyInitiative'
}

/**
 * Service for interacting with the Azure Policy API
 */
export class AzurePolicyService {
    private authService: AzureAuthService;
    private logger = Logger.getInstance();

    constructor() {
        this.authService = new AzureAuthService();
    }

    /**
     * Determines whether a policy ID is for a policy definition or initiative
     * @param policyId The policy ID to check
     * @returns The policy type
     * @throws Error if the ID format is invalid
     */
    public determinePolicyType(policyId: string): PolicyType {
        if (policyId.includes('/providers/Microsoft.Authorization/policyDefinitions/')) {
            return PolicyType.PolicyDefinition;
        } else if (policyId.includes('/providers/Microsoft.Authorization/policySetDefinitions/')) {
            return PolicyType.PolicyInitiative;
        } else {
            throw new Error('Invalid policy ID format. ID should contain "/providers/Microsoft.Authorization/policyDefinitions/" or "/providers/Microsoft.Authorization/policySetDefinitions/"');
        }
    }

    /**
     * Fetches a policy definition or initiative by ID
     * @param policyId The policy ID to fetch
     * @returns Promise resolving to the fetched policy object
     * @throws Error if authentication fails or policy not found
     */
    public async fetchPolicyById(policyId: string): Promise<any> {
        try {
            // Mask policy ID for logging by truncating the middle section
            const maskedPolicyId = this.maskResourceId(policyId);
            this.logger.info(`Fetching policy with ID: ${maskedPolicyId}`);
            
            // Get context info first - we'll reuse this instead of calling it twice
            const contextInfo = await this.authService.getAzureContextInfo();
            
            // Check if logged in based on context info
            if (!contextInfo) {
                this.logger.info('User not logged in to Azure, prompting login');
                await this.authService.promptLogin();
                
                // Re-check after prompt
                const newContextInfo = await this.authService.getAzureContextInfo();
                if (!newContextInfo) {
                    throw new Error('You must be logged in to Azure PowerShell to fetch policies.');
                }
                
                // Show masked tenant ID to the user
                const maskedTenantId = this.maskString(newContextInfo.tenantId);
                vscode.window.showInformationMessage(
                    `Using Azure tenant: ${maskedTenantId}`
                );
            } else {
                // We already have context info, use it directly
                const maskedTenantId = this.maskString(contextInfo.tenantId);
                vscode.window.showInformationMessage(
                    `Using Azure tenant: ${maskedTenantId}`
                );
            }
            
            // Determine policy type
            const policyType = this.determinePolicyType(policyId);
            this.logger.info(`Policy type determined: ${policyType}`);
            
            // Use PowerShell to get the policy definition
            const result = await this.getPolicyWithPowerShell(policyId, policyType);
            
            if (!result) {
                throw new Error('Failed to fetch policy from Azure. The policy ID might be invalid or you might not have access to it.');
            }
            
            return result;
        } catch (error) {
            this.logger.error(`Error fetching policy: ${error instanceof Error ? error.message : 'Unknown error'}`);
            
            // Re-throw errors that we've already processed
            if (error instanceof Error) {
                throw error;
            }
            
            throw new Error('Unknown error fetching policy from Azure');
        }
    }
    
    /**
     * Gets a policy definition using PowerShell
     * @param policyId The policy ID
     * @param policyType The type of policy (definition or initiative)
     * @returns Promise resolving to the policy data
     */
    private async getPolicyWithPowerShell(policyId: string, policyType: PolicyType): Promise<any> {
        try {
            this.logger.info(`Getting policy using PowerShell: ${policyId}`);
            
            // Determine which script to use based on policy type
            const scriptName = policyType === PolicyType.PolicyDefinition 
                ? 'Get-PolicyDefinition.ps1' 
                : 'Get-PolicySetDefinition.ps1';
            
            // Get the extension path to locate our bundled scripts
            const extensionPath = vscode.extensions.getExtension('hardstahl.epacman')?.extensionPath;
            if (!extensionPath) {
                throw new Error('Could not determine extension path');
            }
            
            // Build the path to the PowerShell script
            const scriptPath = `${extensionPath}/scripts/powershell/${scriptName}`;
            this.logger.info(`Using script: ${scriptPath}`);
            
            // Try to use PowerShell Core (pwsh) first, fall back to Windows PowerShell if not available
            // This provides better cross-platform support
            let psCommand: string;
            
            // Check if PowerShell Core is available
            try {
                // Use a synchronous check first
                const { execSync } = require('child_process');
                execSync('pwsh -Command "exit"', { stdio: 'ignore' });
                // If we get here, pwsh is available
                psCommand = `pwsh -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -PolicyId "${policyId}" -Verbose`;
                this.logger.debug(`Using PowerShell Core for policy retrieval`);
            } catch (error) {
                // PowerShell Core not available, fall back to Windows PowerShell
                psCommand = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -PolicyId "${policyId}" -Verbose`;
                this.logger.debug(`Falling back to Windows PowerShell for policy retrieval`);
            }
            
            this.logger.debug(`Executing PowerShell command: ${psCommand}`);
            
            // Execute with a longer timeout
            const { stdout, stderr } = await execAsync(psCommand, { timeout: 60000 });
            
            // Check for errors from PowerShell
            if (stderr) {
                this.logger.error(`PowerShell error output: ${stderr}`);
                throw new Error(`Error retrieving policy: ${stderr}`);
            }
            
            if (!stdout || !stdout.trim()) {
                this.logger.error('No output from PowerShell script');
                throw new Error('No policy data returned from Azure. The policy ID might be invalid or you might not have access to it.');
            }
            
            // Look for JSON output in the stdout - it should be a valid JSON object
            // First check if the output contains our delimiters
            const startMarker = "---POLICY_JSON_START---";
            const endMarker = "---POLICY_JSON_END---";
            
            const startIndex = stdout.indexOf(startMarker);
            const endIndex = stdout.indexOf(endMarker);
            
            let jsonContent;
            
            if (startIndex !== -1 && endIndex !== -1) {
                // Extract the content between the markers
                jsonContent = stdout.substring(startIndex + startMarker.length, endIndex).trim();
                this.logger.debug(`Found delimited JSON content`);
            } else {
                // Fall back to regex matching for backward compatibility
                const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    this.logger.error('No valid JSON object found in PowerShell output');
                    this.logger.error(`Raw PowerShell output: ${stdout.substring(0, 1000)}${stdout.length > 1000 ? '... (truncated)' : ''}`);
                    throw new Error('Failed to extract JSON data from PowerShell output');
                }
                jsonContent = jsonMatch[0];
            }
            
            try {
                // Parse the JSON output
                const policyData = JSON.parse(jsonContent);
                this.logger.info('Successfully parsed policy data from PowerShell script');
                
                // Validate the parsed data
                if (!policyData) {
                    this.logger.error('Policy data is empty after parsing');
                    throw new Error('Retrieved policy data is empty');
                }
                
                // Log parameter information
                if (policyData.Parameters && Object.keys(policyData.Parameters).length > 0) {
                    const paramCount = Object.keys(policyData.Parameters).length;
                    this.logger.info(`Found Parameters object with ${paramCount} parameters`);
                } else {
                    this.logger.info('No Parameters found in policy data or Parameters is empty');
                }
                
                // Return the policy data and type in the expected format
                return {
                    policyData,
                    policyType
                };
            } catch (parseError) {
                // Log only essential information, not raw JSON content
                this.logger.error(`Error parsing policy JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
                
                // Create a sanitized error message for the user
                throw new Error('Failed to parse policy data from Azure. The data format may be invalid.');
            }
        } catch (error) {
            // Handle and log error
            this.logger.error(`Unexpected error in getPolicyWithPowerShell: ${error instanceof Error ? error.message : 'Unknown error'}`);
            
            if (error instanceof Error) {
                const errorMessage = error.message;
                
                if (errorMessage.includes("PolicyDefinitionNotFound") || errorMessage.includes("ResourceNotFound")) {
                    throw new Error(`Policy with ID "${policyId}" not found. Please check the ID and try again.`);
                } else if (errorMessage.includes("AuthorizationFailed") || errorMessage.includes("Forbidden")) {
                    throw new Error(`You don't have permission to access this policy. Your account may not have the necessary role assignments.`);
                }
            }
            
            throw error;
        }
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
     * Masks a resource ID for logging by keeping the resource type and name visible
     * but masking the subscription ID and other sensitive parts
     * @param resourceId The Azure resource ID to mask
     * @returns The masked resource ID
     */
    private maskResourceId(resourceId: string): string {
        if (!resourceId) {
            return '***';
        }
        
        try {
            // Extract the last part (resource name) and the provider part
            const parts = resourceId.split('/');
            if (parts.length < 3) {
                return this.maskString(resourceId);
            }
            
            // Keep the resource type and name parts visible
            const resourceName = parts[parts.length - 1];
            const resourceTypeName = parts[parts.length - 2];
            return `.../${resourceTypeName}/${resourceName}`;
        } catch {
            // Fallback to simple masking if parsing fails
            return this.maskString(resourceId);
        }
    }
}