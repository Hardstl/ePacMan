import { PolicyType } from '../azure/azure-policy-service';
import { Logger } from '../logging';

/**
 * Adapter to convert Azure policy and initiative formats to the internal format
 */
export class AzurePolicyAdapter {
    private logger = Logger.getInstance();

    /**
     * Converts an Azure policy definition or initiative to the internal format
     * @param policyData The policy data from the Azure API or PowerShell
     * @param policyType The type of the policy (definition or initiative)
     * @returns The converted policy definition in the internal format
     */
    public convertToInternalFormat(policyData: any, policyType: PolicyType): any {
        if (policyType === PolicyType.PolicyDefinition) {
            return this.convertPolicyDefinition(policyData);
        } else {
            return this.convertPolicyInitiative(policyData);
        }
    }

    /**
     * Converts an Azure policy definition to the internal format
     * @param policyData The policy definition data
     * @returns The converted policy definition
     */
    private convertPolicyDefinition(policyData: any): any {
        this.logger.debug(`Converting policy definition: ${JSON.stringify(policyData, null, 2)}`);
        
        // Handle different formats (PowerShell vs API)
        // PowerShell format uses different casing and property names
        const properties: any = {};
        
        // Extract display name
        if (policyData.properties?.displayName) {
            properties.displayName = policyData.properties.displayName;
        } else if (policyData.DisplayName) {
            properties.displayName = policyData.DisplayName;
        }
        
        // Extract description
        if (policyData.properties?.description) {
            properties.description = policyData.properties.description;
        } else if (policyData.Description) {
            properties.description = policyData.Description;
        }
        
        // Extract metadata
        if (policyData.properties?.metadata) {
            properties.metadata = policyData.properties.metadata;
        } else if (policyData.Metadata) {
            properties.metadata = policyData.Metadata;
        }
        
        // Extract parameters - special handling for PowerShell output format
        this.logger.info("Extracting parameters from policy definition");
        if (policyData.properties?.parameters) {
            properties.parameters = policyData.properties.parameters;
            this.logger.info(`Found ${Object.keys(properties.parameters).length} parameters in policy properties.parameters`);
        } else if (policyData.Parameters && Object.keys(policyData.Parameters).length > 0) {
            // For our enhanced extraction method that uses Parameters (with an s)
            // Check if Parameters values are already in the correct format or need conversion
            if (this.isValidParameterFormat(policyData.Parameters)) {
                properties.parameters = policyData.Parameters;
                this.logger.info(`Using ${Object.keys(properties.parameters).length} parameters from enhanced Parameters object`);
            } else {
                // Need to convert the PowerShell nested object format
                properties.parameters = this.extractPowerShellParameters(policyData.Parameters);
                this.logger.info(`Converted ${Object.keys(properties.parameters).length} parameters from enhanced Parameters object`);
            }
        } else if (policyData.Parameter && Object.keys(policyData.Parameter).length > 0) {
            // PowerShell output has Parameter (capital P) with PSCustomObject properties 
            properties.parameters = this.extractPowerShellParameters(policyData.Parameter);
            this.logger.info(`Processed ${Object.keys(properties.parameters).length} parameters from policy Parameter`);
        } else {
            this.logger.warn("No parameters found in policy definition");
            properties.parameters = {};
        }
        
        // Extract policy rule
        if (policyData.properties?.policyRule) {
            properties.policyRule = policyData.properties.policyRule;
        } else if (policyData.PolicyRule) {
            properties.policyRule = policyData.PolicyRule;
        }
        
        return {
            name: policyData.name || policyData.Name,
            properties
        };
    }
    
    /**
     * Extracts parameters from PowerShell PSCustomObject format
     * @param parameter The Parameter object from PowerShell
     * @returns Normalized parameters object
     */
    private extractPowerShellParameters(parameter: any): any {
        this.logger.debug("Extracting PowerShell parameters");
        
        // If parameter is null or undefined, return an empty object
        if (!parameter) {
            this.logger.warn("Parameter object is null or undefined");
            return {};
        }
        
        try {
            // Create a new object to store the extracted parameters
            const convertedParams: Record<string, any> = {};
            
            // PowerShell parameters could be in various formats
            // First check if it's already a well-structured object with parameter names as keys
            if (typeof parameter === 'object' && !Array.isArray(parameter)) {
                // Get all keys that aren't standard object methods or internal properties
                const paramNames = Object.keys(parameter).filter(key => 
                    typeof key === 'string' && 
                    !key.startsWith('_') && 
                    !['Equals', 'GetHashCode', 'GetType', 'ToString'].includes(key)
                );
                
                this.logger.debug(`Found parameter names: ${paramNames.join(', ')}`);
                
                for (const paramName of paramNames) {
                    const paramDef = parameter[paramName];
                    
                    // Skip if parameter definition is null or not an object
                    if (!paramDef || typeof paramDef !== 'object') {
                        this.logger.debug(`Parameter ${paramName} has invalid definition`);
                        continue;
                    }
                    
                    // Create a new parameter definition object
                    const parameterDefinition: any = {};
                    
                    // Extract parameter properties with case-insensitive approach
                    // For each possible property, check both camelCase and PascalCase versions
                    
                    // Type
                    if (paramDef.type !== undefined) {
                        parameterDefinition.type = paramDef.type;
                    } else if (paramDef.Type !== undefined) {
                        parameterDefinition.type = paramDef.Type;
                    }
                    
                    // Default Value
                    if (paramDef.defaultValue !== undefined) {
                        parameterDefinition.defaultValue = paramDef.defaultValue;
                    } else if (paramDef.DefaultValue !== undefined) {
                        parameterDefinition.defaultValue = paramDef.DefaultValue;
                    }
                    
                    // Allowed Values
                    if (paramDef.allowedValues !== undefined) {
                        parameterDefinition.allowedValues = paramDef.allowedValues;
                    } else if (paramDef.AllowedValues !== undefined) {
                        parameterDefinition.allowedValues = paramDef.AllowedValues;
                    }
                    
                    // Metadata
                    if (paramDef.metadata !== undefined) {
                        parameterDefinition.metadata = paramDef.metadata;
                    } else if (paramDef.Metadata !== undefined) {
                        parameterDefinition.metadata = paramDef.Metadata;
                    } else {
                        // Ensure metadata exists even if empty
                        parameterDefinition.metadata = {};
                    }
                    
                    // Ensure type exists (required for valid parameter)
                    if (!parameterDefinition.type) {
                        this.logger.warn(`Parameter ${paramName} missing required type property, defaulting to "string"`);
                        parameterDefinition.type = "string";
                    }
                    
                    // Add the parameter definition to our result
                    convertedParams[paramName] = parameterDefinition;
                    this.logger.debug(`Added parameter: ${paramName} with type: ${parameterDefinition.type}`);
                }
            }
            
            this.logger.debug(`Extracted ${Object.keys(convertedParams).length} parameters`);
            return convertedParams;
        } catch (error) {
            this.logger.error(`Error extracting PowerShell parameters: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Return an empty object in case of error to avoid breaking the flow
            return {};
        }
    }

    /**
     * Checks if the parameters object is already in a valid format
     * @param parameters The parameters object to check
     * @returns True if the parameters are already in a valid format
     */
    private isValidParameterFormat(parameters: any): boolean {
        if (!parameters || typeof parameters !== 'object') {
            return false;
        }

        // Check a sample parameter to see if it has the expected structure
        const paramKeys = Object.keys(parameters);
        if (paramKeys.length === 0) {
            return true; // Empty object is considered valid
        }

        // Check the first parameter to see if it looks like a valid parameter definition
        const firstParam = parameters[paramKeys[0]];
        
        // A valid parameter should be an object with at least a 'type' property
        // or other expected parameter properties
        return (
            firstParam && 
            typeof firstParam === 'object' && 
            !Array.isArray(firstParam) &&
            (firstParam.type !== undefined || 
             firstParam.Type !== undefined ||
             firstParam.defaultValue !== undefined ||
             firstParam.DefaultValue !== undefined ||
             firstParam.allowedValues !== undefined ||
             firstParam.AllowedValues !== undefined)
        );
    }

    /**
     * Converts an Azure policy initiative (set) to the internal format
     * @param policyData The policy initiative data
     * @returns The converted policy initiative
     */
    private convertPolicyInitiative(policyData: any): any {
        // Handle different formats (PowerShell vs API)
        const properties: any = {};
        
        // Extract display name
        if (policyData.properties?.displayName) {
            properties.displayName = policyData.properties.displayName;
        } else if (policyData.DisplayName) {
            properties.displayName = policyData.DisplayName;
        }
        
        // Extract description
        if (policyData.properties?.description) {
            properties.description = policyData.properties.description;
        } else if (policyData.Description) {
            properties.description = policyData.Description;
        }
        
        // Extract metadata
        if (policyData.properties?.metadata) {
            properties.metadata = policyData.properties.metadata;
        } else if (policyData.Metadata) {
            properties.metadata = policyData.Metadata;
        }
        
        // Extract parameters - this is a key fix for PowerShell output
        this.logger.info("Extracting parameters from policy set definition");
        if (policyData.properties?.parameters) {
            properties.parameters = policyData.properties.parameters;
            this.logger.info(`Found ${Object.keys(properties.parameters).length} parameters in policy set properties.parameters`);
        } else if (policyData.Parameters && Object.keys(policyData.Parameters).length > 0) {
            // For our enhanced extraction method that uses Parameters (with an s)
            if (this.isValidParameterFormat(policyData.Parameters)) {
                properties.parameters = policyData.Parameters;
                this.logger.info(`Using ${Object.keys(properties.parameters).length} parameters from enhanced Parameters object`);
            } else {
                // Need to convert the PowerShell nested object format
                properties.parameters = this.extractPowerShellParameters(policyData.Parameters);
                this.logger.info(`Converted ${Object.keys(properties.parameters).length} parameters from enhanced Parameters object`);
            }
        } else if (policyData.Parameter && Object.keys(policyData.Parameter).length > 0) {
            // PowerShell output has Parameter (capital P) instead of parameters
            properties.parameters = this.extractPowerShellParameters(policyData.Parameter);
            this.logger.info(`Processed ${Object.keys(properties.parameters).length} parameters from policy set Parameter`);
        } else {
            this.logger.warn("No parameters found in policy set definition");
            properties.parameters = {};
        }
        
        // Extract policy definitions
        if (policyData.properties?.policyDefinitions) {
            properties.policyDefinitions = policyData.properties.policyDefinitions;
        } else if (policyData.PolicyDefinitions) {
            properties.policyDefinitions = policyData.PolicyDefinitions;
        }
        
        // Extract policy definition groups if available
        if (policyData.properties?.policyDefinitionGroups) {
            properties.policyDefinitionGroups = policyData.properties.policyDefinitionGroups;
        } else if (policyData.PolicyDefinitionGroups) {
            properties.policyDefinitionGroups = policyData.PolicyDefinitionGroups;
        }
        
        return {
            name: policyData.name || policyData.Name,
            properties
        };
    }
}