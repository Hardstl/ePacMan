import { Logger } from '../logging';

/**
 * Interface for policy definition
 */
export interface PolicyDefinition {
    name: string;
    type?: string;
    properties?: {
        displayName?: string;
        description?: string;
        parameters?: Record<string, any>;
        policyDefinitions?: any[];
        policyRule?: any;
    };
}

/**
 * Interface for policy assignment template
 */
export interface PolicyAssignmentTemplate {
    $schema: string;
    nodeName: string;
    scope: Record<string, string[]>;
    assignment: {
        name: string;
        displayName: string;
        description: string;
    };
    definitionEntry: {
        policyId?: string;
        policyName?: string;
        policySetId?: string;
        policySetName?: string;
        displayName: string;
        sourceType?: string;
        source?: string;
    };
    parameters: Record<string, any>;
    nonComplianceMessages: {
        message: string;
        policyDefinitionReferenceId?: string;
    }[];
    additionalRoleAssignments?: Record<string, any[]>;
    children?: PolicyAssignmentTemplate[];
}

/**
 * Template Generator class
 * Responsible for generating policy assignment templates from policy definitions
 */
export class TemplateGenerator {
    private logger = Logger.getInstance();
    
    /**
     * Generate a policy assignment template from a policy definition
     * @param policyDefinition The policy definition
     * @returns The policy assignment template
     */
    generateAssignmentTemplate(policyDefinition: PolicyDefinition): PolicyAssignmentTemplate {
        try {
            this.logger.info(`Generating assignment template for policy: ${policyDefinition.name}`);
            
            // Determine if this is a policy or policy set
            const isPolicySet = this.isPolicySet(policyDefinition);
            
            // Create the basic template
            const template: PolicyAssignmentTemplate = {
                $schema: "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/policy-assignment-schema.json",
                nodeName: "/root",
                scope: {
                    // Use a generic scope that can be replaced by the user
                    tenant1: [
                        "/providers/Microsoft.Management/managementGroups/<management-group-id>"
                    ]
                },
                assignment: {
                    name: policyDefinition.name,
                    displayName: policyDefinition.properties?.displayName || policyDefinition.name,
                    description: policyDefinition.properties?.description || ""
                },
                definitionEntry: isPolicySet ? {
                    policySetName: policyDefinition.name,
                    displayName: policyDefinition.properties?.displayName || policyDefinition.name
                } : {
                    policyName: policyDefinition.name,
                    displayName: policyDefinition.properties?.displayName || policyDefinition.name
                },
                parameters: this.mapParameters(policyDefinition),
                nonComplianceMessages: [
                    {
                        message: `${policyDefinition.properties?.displayName || policyDefinition.name}`
                    }
                ]
            };
            
            this.logger.info(`Assignment template generated successfully`);
            return template;
        } catch (error: any) {
            this.logger.error(`Error generating assignment template: ${error.message}`, error);
            throw new Error(`Failed to generate assignment template: ${error.message}`);
        }
    }
    
    /**
     * Determine if a policy definition is a policy set
     * @param policyDefinition The policy definition
     * @returns True if the policy definition is a policy set, false otherwise
     */
    private isPolicySet(policyDefinition: PolicyDefinition): boolean {
        // Policy sets have a policyDefinitions array property
        return policyDefinition.properties !== undefined &&
               Array.isArray(policyDefinition.properties.policyDefinitions);
    }
    
    /**
     * Map parameters from a policy definition to a policy assignment
     * @param policyDefinition The policy definition
     * @returns The mapped parameters
     */
    private mapParameters(policyDefinition: PolicyDefinition): Record<string, any> {
        const parameters: Record<string, any> = {};
        
        // Log the incoming parameters for debugging
        this.logger.debug(`Mapping parameters from policy definition: ${JSON.stringify(policyDefinition.properties?.parameters, null, 2)}`);
        
        // Extract parameters from the policy definition
        if (policyDefinition.properties?.parameters) {
            for (const [key, param] of Object.entries(policyDefinition.properties.parameters)) {
                this.logger.debug(`Processing parameter: ${key} with value: ${JSON.stringify(param, null, 2)}`);
                
                // Skip the effect parameter as it's handled separately
                if (key === 'effect') {
                    parameters[key] = param.defaultValue || this.getFirstAllowedValue(param);
                    this.logger.debug(`Set effect parameter to: ${parameters[key]}`);
                    continue;
                }
                
                // Map the parameter with its default value
                if (param.defaultValue !== undefined) {
                    parameters[key] = param.defaultValue;
                    this.logger.debug(`Using default value for ${key}: ${JSON.stringify(param.defaultValue)}`);
                } else {
                    // If no default value, use a placeholder or the first allowed value
                    parameters[key] = this.getParameterPlaceholder(param);
                    this.logger.debug(`Using placeholder for ${key}: ${JSON.stringify(parameters[key])}`);
                }
            }
        } else {
            this.logger.warn("No parameters found in policy definition properties");
        }
        
        this.logger.debug(`Final mapped parameters: ${JSON.stringify(parameters, null, 2)}`);
        return parameters;
    }
    
    /**
     * Get the first allowed value for a parameter
     * @param param The parameter
     * @returns The first allowed value, or null if none
     */
    private getFirstAllowedValue(param: any): any {
        if (param.allowedValues && param.allowedValues.length > 0) {
            return param.allowedValues[0];
        }
        return null;
    }
    
    /**
     * Get a placeholder value for a parameter based on its type
     * @param param The parameter
     * @returns A placeholder value
     */
    private getParameterPlaceholder(param: any): any {
        // Create an appropriate placeholder based on the parameter type
        if (param.type === 'string') {
            return "<string-value>";
        } else if (param.type === 'array') {
            return [];
        } else if (param.type === 'object') {
            return {};
        } else if (param.type === 'boolean') {
            return false;
        } else if (param.type === 'integer' || param.type === 'number') {
            return 0;
        }
        
        return null;
    }
}