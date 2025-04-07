# Script to fetch policy definition and convert to JSON
param(
    [Parameter(Mandatory=$true)]
    [string]$PolicyId
)

$ErrorActionPreference = "Stop"
$VerbosePreference = "Continue"

# Log start of script execution
Write-Verbose "Starting policy definition fetch for ID: $PolicyId"
Write-Verbose "PowerShell Version: $($PSVersionTable.PSVersion)"
Write-Verbose "PowerShell Edition: $($PSVersionTable.PSEdition)"

try {
    # Check if the Az.Resources module is available
    $resourcesModuleAvailable = Get-Module -ListAvailable Az.Resources -ErrorAction SilentlyContinue
    
    if (-not $resourcesModuleAvailable) {
        Write-Verbose "Az.Resources module is not installed"
        
        # Output a structured error message with delimiters
        Write-Output "---POLICY_JSON_START---"
        Write-Output "{""error"": ""Az.Resources module not installed"", ""errorType"": ""ModuleNotFound""}"
        Write-Output "---POLICY_JSON_END---"
        
        # Also write an error for logging purposes
        Write-Error "Az.Resources module is not installed. Please install it with: Install-Module -Name Az -Scope CurrentUser -Repository PSGallery -Force"
        exit 0
    }
    
    # Import the Az.Resources module if not already loaded
    if (-not (Get-Module -Name Az.Resources)) {
        Write-Verbose "Importing Az.Resources module"
        Import-Module Az.Resources -ErrorAction Stop
    }
    # Fetch the policy
    $policy = Get-AzPolicyDefinition -Id $PolicyId
    
    # Validate policy was retrieved
    if ($null -eq $policy) {
        Write-Error "Policy not found or access denied for ID: $PolicyId"
        exit 1
    }
    
    Write-Verbose "Successfully retrieved policy: $($policy.Name)"
    
    # Create a new object to better control the output format
    $policyOutput = @{
        Name = $policy.Name
        DisplayName = $policy.DisplayName
        Description = $policy.Description
        Metadata = $policy.Metadata
        PolicyType = $policy.PolicyType
        Mode = $policy.Mode
        PolicyRule = $policy.PolicyRule
        Parameters = @{}
        Type = $policy.Type
        Id = $policy.Id
    }
    
    # Extract parameters
    if ($policy.Parameter) {
        Write-Verbose "Found parameters in policy, processing..."
        $paramObject = @{}
        $policy.Parameter | Get-Member -MemberType NoteProperty | ForEach-Object {
            $paramName = $_.Name
            $param = $policy.Parameter.$paramName
            
            # Create parameter object with proper structure
            $paramDetails = @{}
            
            # Add type (required)
            if ($null -ne $param.type) { 
                $paramDetails['type'] = $param.type
            } elseif ($null -ne $param.Type) {
                $paramDetails['type'] = $param.Type
            } else {
                $paramDetails['type'] = 'string'
            }
            
            # Add optional properties
            if ($null -ne $param.defaultValue) { 
                $paramDetails['defaultValue'] = $param.defaultValue
            } elseif ($null -ne $param.DefaultValue) {
                $paramDetails['defaultValue'] = $param.DefaultValue
            }
            
            if ($null -ne $param.allowedValues) { 
                $paramDetails['allowedValues'] = $param.allowedValues
            } elseif ($null -ne $param.AllowedValues) {
                $paramDetails['allowedValues'] = $param.AllowedValues
            }
            
            if ($null -ne $param.metadata) { 
                $paramDetails['metadata'] = $param.metadata
            } elseif ($null -ne $param.Metadata) {
                $paramDetails['metadata'] = $param.Metadata
            }
            
            # Add parameter to the parameters object
            $paramObject[$paramName] = $paramDetails
            Write-Verbose "Processed parameter: $paramName"
        }
        
        # Set parameters in the output object
        $policyOutput.Parameters = $paramObject
        Write-Verbose "Added $($paramObject.Count) parameters to output"
    } else {
        Write-Verbose "No parameters found in policy"
    }
    
    # Convert to JSON with sufficient depth
    $jsonOutput = ConvertTo-Json -InputObject $policyOutput -Depth 20 -Compress:$false
    
    # Output the JSON with delimiters to make parsing easier
    Write-Output "---POLICY_JSON_START---"
    Write-Output $jsonOutput
    Write-Output "---POLICY_JSON_END---"
    
    Write-Verbose "Successfully generated JSON output"
} catch {
    Write-Verbose "Error getting policy definition: $_"
    Write-Error "Error in PowerShell script: $_"
    
    # Even in case of error, output empty JSON with delimiters
    Write-Output "---POLICY_JSON_START---"
    Write-Output "{""error"": ""$($_.ToString().Replace('"', '\"'))"", ""errorType"": ""ExecutionError""}"
    Write-Output "---POLICY_JSON_END---"
    exit 1
}
