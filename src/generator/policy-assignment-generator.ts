import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { Logger } from '../logging';
import { TemplateGenerator, PolicyDefinition } from './template-generator';
import { PolicyDefinitionParser } from './policy-definition-parser';
import { FileCreator } from './file-creator';
import { AzurePolicyAdapter } from './azure-policy-adapter';
import { AzurePolicyService, PolicyType } from '../azure/azure-policy-service';

/**
 * Generator for policy assignments
 */
export class PolicyAssignmentGenerator {
    private logger = Logger.getInstance();
    private templateGenerator: TemplateGenerator;
    private policyDefinitionParser: PolicyDefinitionParser;
    private fileCreator: FileCreator;
    private azurePolicyAdapter: AzurePolicyAdapter;
    private azurePolicyService: AzurePolicyService;

    constructor() {
        this.templateGenerator = new TemplateGenerator();
        this.policyDefinitionParser = new PolicyDefinitionParser();
        this.fileCreator = new FileCreator();
        this.azurePolicyAdapter = new AzurePolicyAdapter();
        this.azurePolicyService = new AzurePolicyService();
    }

    /**
     * Generate a policy assignment from a policy definition file
     * @param policyDefinitionUri The URI of the policy definition file
     */
    public async generateAssignment(policyDefinitionUri: vscode.Uri): Promise<void> {
        try {
            this.logger.info(`Generating policy assignment for: ${policyDefinitionUri.fsPath}`);
            
            // Parse the policy definition
            const policyDefinition = await this.policyDefinitionParser.parseFile(policyDefinitionUri);
            
            // Generate the assignment template
            const assignmentTemplate = this.templateGenerator.generateAssignmentTemplate(policyDefinition);
            
            // Create the assignment file
            await this.fileCreator.createAssignmentFile(policyDefinitionUri, assignmentTemplate);
            
            this.logger.info('Policy assignment generated successfully');
        } catch (error: any) {
            this.logger.error(`Error generating assignment: ${error.message}`, error);
            throw new Error(`Error generating assignment: ${error.message}`);
        }
    }
    
    /**
     * Generate a policy assignment from an Azure policy
     * @param policyId The Azure policy ID
     */
    public async generateAssignmentFromAzure(policyId: string): Promise<void> {
        try {
            this.logger.info(`Generating policy assignment from Azure for policy ID: ${policyId}`);
            
            // Fetch the policy from Azure
            const { policyData, policyType } = await this.azurePolicyService.fetchPolicyById(policyId);
            
            // Convert the Azure policy to the internal format
            const policyDefinition = this.azurePolicyAdapter.convertToInternalFormat(policyData, policyType);
            
            // Log parameter information before generating the template
            if (policyDefinition.properties?.parameters) {
                this.logger.info(`Policy has ${Object.keys(policyDefinition.properties.parameters).length} parameters: ${Object.keys(policyDefinition.properties.parameters).join(', ')}`);
            } else {
                this.logger.warn('No parameters found in the converted policy definition');
            }
            
            // Generate the assignment template
            const assignmentTemplate = this.templateGenerator.generateAssignmentTemplate(policyDefinition);
            
            // Log the parameters that were mapped to the template
            this.logger.info(`Template parameters: ${JSON.stringify(assignmentTemplate.parameters, null, 2)}`);
            
            // Get the display name for later use
            const displayName = policyDefinition.properties?.displayName || policyDefinition.name;
            
            // Set the correct properties in definitionEntry based on policy type
            if (policyType === PolicyType.PolicyDefinition) {
                // For policy definitions, set policyId first
                assignmentTemplate.definitionEntry = {
                    policyId,
                    displayName,
                };
            } else {
                // For policy initiatives (sets), set policySetId first
                assignmentTemplate.definitionEntry = {
                    policySetId: policyId,
                    displayName,
                };
            }
            
            // Create the assignment file without a source URI
            await this.fileCreator.createAssignmentFileFromAzure(
                policyDefinition.name, 
                assignmentTemplate
            );
            
            this.logger.info('Policy assignment generated successfully from Azure');
        } catch (error: any) {
            this.logger.error(`Error generating assignment from Azure: ${error.message}`, error);
            throw new Error(`Error generating assignment from Azure: ${error.message}`);
        }
    }
}