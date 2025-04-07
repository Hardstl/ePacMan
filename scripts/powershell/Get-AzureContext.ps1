# Script to get Azure context information
$ErrorActionPreference = "Stop"
$VerbosePreference = "Continue"

# Log start of script execution
Write-Verbose "Starting Azure context information lookup"

try {
    # Output PowerShell version info for debugging
    Write-Verbose "PowerShell Version: $($PSVersionTable.PSVersion)"
    Write-Verbose "PowerShell Edition: $($PSVersionTable.PSEdition)"
    
    # First check if the Az.Accounts module is available
    $moduleAvailable = Get-Module -ListAvailable Az.Accounts -ErrorAction SilentlyContinue
    
    if (-not $moduleAvailable) {
        Write-Verbose "Az.Accounts module is not installed"
        
        # Output a structured error message with delimiters
        Write-Output "---AZURE_CONTEXT_START---"
        Write-Output "{""error"": ""Az.Accounts module not installed"", ""errorType"": ""ModuleNotFound""}"
        Write-Output "---AZURE_CONTEXT_END---"
        
        # Also write an error for logging purposes
        Write-Error "Az.Accounts module is not installed. Please install it with: Install-Module -Name Az -Scope CurrentUser -Repository PSGallery -Force"
        exit 0
    }
    
    # Import the Az.Accounts module if not already loaded
    if (-not (Get-Module -Name Az.Accounts)) {
        Write-Verbose "Importing Az.Accounts module"
        Import-Module Az.Accounts -ErrorAction Stop
    }

    # Get the current Azure context
    $context = Get-AzContext
    if (-not $context) {
        Write-Verbose "No Azure context found"
        Write-Output "---AZURE_CONTEXT_START---"
        Write-Output "{}"
        Write-Output "---AZURE_CONTEXT_END---"
        exit 0
    }
    
    Write-Verbose "Azure context found: Account=$($context.Account.Id), Tenant=$($context.Tenant.Id), Subscription=$($context.Subscription.Name)"
    
    # Create a formatted object with context information
    $contextInfo = [PSCustomObject]@{
        TenantId = $context.Tenant.Id
        SubscriptionId = $context.Subscription.Id
        SubscriptionName = $context.Subscription.Name
        Account = $context.Account.Id
    }
    
    # Convert to JSON and output with clear delimiters
    $jsonOutput = $contextInfo | ConvertTo-Json -Compress
    
    # Output with clear delimiters to make parsing easier
    Write-Output "---AZURE_CONTEXT_START---"
    Write-Output $jsonOutput
    Write-Output "---AZURE_CONTEXT_END---"
    
    Write-Verbose "Successfully returned context information"
} catch {
    Write-Verbose "Error getting Azure context: $_"
    Write-Error "Error getting Azure context: $_"
    
    # Even in case of error, output empty JSON with delimiters
    Write-Output "---AZURE_CONTEXT_START---"
    Write-Output "{}"
    Write-Output "---AZURE_CONTEXT_END---"
    exit 1
}