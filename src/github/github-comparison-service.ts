import * as vscode from 'vscode';
import * as path from 'path';
import { GitHubService } from './github-service';
import { FileComparisonUtility } from './file-comparison';
import { Logger } from '../logging';
import { ErrorHandler } from '../error';

/**
 * Service for comparing local policy files with GitHub versions
 */
export class GitHubComparisonService {
    private readonly githubService: GitHubService;
    private readonly fileComparisonUtility: FileComparisonUtility;
    private readonly logger: Logger;
    private updateCommandDisposable: vscode.Disposable | undefined;
    private updateButtonDisposable: vscode.Disposable | undefined;
    private updateButton: vscode.StatusBarItem | undefined;
    private static instance: GitHubComparisonService;
    
    /**
     * Get the singleton instance of the GitHubComparisonService
     * @returns The singleton instance
     */
    public static getInstance(): GitHubComparisonService {
        if (!GitHubComparisonService.instance) {
            GitHubComparisonService.instance = new GitHubComparisonService();
        }
        return GitHubComparisonService.instance;
    }
    
    /**
     * Private constructor to enforce singleton pattern
     */
    private constructor() {
        this.githubService = new GitHubService();
        this.fileComparisonUtility = new FileComparisonUtility();
        this.logger = Logger.getInstance();
    }
    
    /**
     * Dispose of any active command registrations
     */
    private disposeExistingCommands(): void {
        if (this.updateCommandDisposable) {
            this.logger.info(`[GitHub Comparison] Disposing existing update command`);
            this.updateCommandDisposable.dispose();
            this.updateCommandDisposable = undefined;
        }
        
        if (this.updateButtonDisposable) {
            this.logger.info(`[GitHub Comparison] Disposing existing button event listener`);
            this.updateButtonDisposable.dispose();
            this.updateButtonDisposable = undefined;
        }
        
        if (this.updateButton) {
            this.logger.info(`[GitHub Comparison] Disposing existing update button`);
            this.updateButton.dispose();
            this.updateButton = undefined;
        }
    }
    
    /**
     * Compare a local file with its GitHub counterpart
     * @param fileUri The URI of the local file to compare
     */
    public async compareWithGitHub(fileUri: vscode.Uri): Promise<void> {
        try {
            // Dispose of any existing commands first to prevent conflicts
            this.disposeExistingCommands();
            
            const filePath = fileUri.fsPath;
            this.logger.info(`[GitHub Comparison] Starting comparison for file: ${filePath}`);
            
            // Check if file exists
            try {
                await vscode.workspace.fs.stat(fileUri);
                this.logger.info(`[GitHub Comparison] File exists: ${filePath}`);
            } catch (error) {
                this.logger.error(`[GitHub Comparison] File does not exist: ${filePath}`, error);
                throw new Error(`File does not exist: ${filePath}`);
            }
            
            // Extract policy name from local file
            this.logger.info(`[GitHub Comparison] Extracting policy name from file: ${filePath}`);
            let policyName: string | null;
            try {
                policyName = await this.fileComparisonUtility.readLocalFileAndExtractPolicyName(filePath);
                if (!policyName) {
                    this.logger.error(`[GitHub Comparison] Could not extract policy name from file: ${filePath}`);
                    throw new Error('Could not extract policy name from local file');
                }
                this.logger.info(`[GitHub Comparison] Extracted policy name: ${policyName}`);
                
                // Log the filename to help with debugging
                const filename = path.basename(filePath);
                this.logger.info(`[GitHub Comparison] Local filename: ${filename}, Policy name: ${policyName}`);
            } catch (error) {
                this.logger.error(`[GitHub Comparison] Error extracting policy name`, error);
                throw new Error(`Error extracting policy name: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            // Determine if this is a policy set definition
            this.logger.info(`[GitHub Comparison] Determining if file is a policy set definition: ${filePath}`);
            let isPolicySet: boolean;
            try {
                isPolicySet = await this.fileComparisonUtility.isPolicySetDefinition(filePath);
                this.logger.info(`[GitHub Comparison] Is policy set: ${isPolicySet}`);
                
                // If the filename contains indicators of a policy set but our detection says it's not,
                // log a warning and force it to true for this specific case
                const filename = path.basename(filePath).toLowerCase();
                if ((filename.includes('policy_set') || filename.includes('initiative') ||
                     policyName.toLowerCase().includes('enforce-guardrails')) && !isPolicySet) {
                    this.logger.warn(`[GitHub Comparison] Filename or policy name suggests this is a policy set, but detection says otherwise. Forcing isPolicySet=true`);
                    isPolicySet = true;
                }
            } catch (error) {
                this.logger.error(`[GitHub Comparison] Error determining if file is a policy set definition`, error);
                throw new Error(`Error determining if file is a policy set definition: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            // Find matching policy file in GitHub
            this.logger.info(`[GitHub Comparison] Finding matching policy in GitHub for: ${policyName} (isPolicySet: ${isPolicySet})`);
            let githubContent: string | null;
            try {
                githubContent = await this.githubService.findPolicyFileByPolicyName(policyName, isPolicySet);
                if (!githubContent) {
                    this.logger.warn(`[GitHub Comparison] No matching policy found in GitHub for: ${policyName}`);
                    vscode.window.showWarningMessage(`No matching policy found in GitHub for: ${policyName}`);
                    return;
                }
                this.logger.info(`[GitHub Comparison] Found matching policy in GitHub for: ${policyName}`);
            } catch (error) {
                this.logger.error(`[GitHub Comparison] Error finding matching policy in GitHub`, error);
                throw new Error(`Error finding matching policy in GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            // Compare the files
            this.logger.info(`[GitHub Comparison] Comparing local and GitHub versions of: ${policyName}`);
            let areIdentical: boolean;
            try {
                areIdentical = await this.fileComparisonUtility.compareFiles(filePath, githubContent);
                this.logger.info(`[GitHub Comparison] Files are identical: ${areIdentical}`);
                
                if (areIdentical) {
                    vscode.window.showInformationMessage(`Policy "${policyName}" is up to date with GitHub version.`);
                    return;
                }
            } catch (error) {
                this.logger.error(`[GitHub Comparison] Error comparing files`, error);
                throw new Error(`Error comparing files: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            // Show diff view
            this.logger.info(`[GitHub Comparison] Showing diff view for: ${policyName}`);
            try {
                await this.fileComparisonUtility.showDiffView(filePath, githubContent, policyName);
                this.logger.info(`[GitHub Comparison] Diff view shown successfully for: ${policyName}`);
            } catch (error) {
                this.logger.error(`[GitHub Comparison] Error showing diff view`, error);
                throw new Error(`Error showing diff view: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            // Register command to update local file
            this.logger.info(`[GitHub Comparison] Registering update command for: ${policyName}`);
            try {
                this.updateCommandDisposable = vscode.commands.registerCommand('epacman.updateToGitHubVersion', async () => {
                    try {
                        this.logger.info(`[GitHub Comparison] Update command triggered for: ${policyName}`);
                        
                        // Confirm before updating
                        const result = await vscode.window.showWarningMessage(
                            `Are you sure you want to update the local file with the GitHub version?`,
                            { modal: true },
                            'Yes', 'No'
                        );
                        
                        if (result === 'Yes') {
                            this.logger.info(`[GitHub Comparison] User confirmed update for: ${policyName}`);
                            try {
                                await this.fileComparisonUtility.updateLocalFile(filePath, githubContent);
                                this.logger.info(`[GitHub Comparison] File updated successfully: ${filePath}`);
                                vscode.window.showInformationMessage(`Successfully updated local file to GitHub version.`);
                            } catch (updateError) {
                                this.logger.error(`[GitHub Comparison] Error updating file: ${filePath}`, updateError);
                                throw updateError;
                            }
                        } else {
                            this.logger.info(`[GitHub Comparison] User cancelled update for: ${policyName}`);
                        }
                    } catch (error: any) {
                        this.logger.error(`[GitHub Comparison] Error in update command handler`, error);
                        ErrorHandler.handleError(error, 'Failed to update local file');
                    } finally {
                        // No need to dispose here as we'll track and dispose in a centralized way
                    }
                });
                
                // Show update button in editor title
                this.logger.info(`[GitHub Comparison] Showing update button for: ${policyName}`);
                this.showUpdateButton();
            } catch (error) {
                this.logger.error(`[GitHub Comparison] Error registering update command`, error);
                throw new Error(`Error registering update command: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            this.logger.info(`[GitHub Comparison] Comparison completed successfully for: ${policyName}`);
            
        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`[GitHub Comparison] Error comparing with GitHub: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`Failed to compare with GitHub: ${errorMessage}`);
            ErrorHandler.handleError(error, 'Failed to compare with GitHub');
        }
    }
    
    /**
     * Show an update button in the editor title
     */
    private showUpdateButton(): void {
        try {
            this.logger.info(`[GitHub Comparison] Creating update button in status bar`);
            
            // Create a status bar item for the update button
            this.updateButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
            this.updateButton.text = "$(cloud-download) Update to GitHub Version";
            this.updateButton.tooltip = "Update local file to match the GitHub version";
            this.updateButton.command = 'epacman.updateToGitHubVersion';
            this.updateButton.show();
            
            this.logger.info(`[GitHub Comparison] Update button created and shown`);
            
            // Dispose the button when the editor is closed
            this.updateButtonDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
                this.logger.info(`[GitHub Comparison] Active editor changed, disposing update button`);
                if (this.updateButton) {
                    this.updateButton.dispose();
                    this.updateButton = undefined;
                }
            });
        } catch (error) {
            this.logger.error(`[GitHub Comparison] Error creating update button`, error);
            // Don't throw here as this is not critical for the main functionality
        }
    }
    
    /**
     * Dispose all resources held by this service
     * This should be called when the extension is deactivated
     */
    public dispose(): void {
        this.logger.info(`[GitHub Comparison] Disposing GitHub comparison service resources`);
        this.disposeExistingCommands();
    }
}