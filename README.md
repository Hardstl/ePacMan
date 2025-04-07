# ePacMan (Enterprise Policy as Code Manager)

A Visual Studio Code extension for managing Azure Policy as Code using the Enterprise Policy as Code (EPAC) framework.

## Features

- **Policy Assignment Management**: Create, view, and manage Azure Policy assignments using a structured, code-based approach.
- **Visual Policy Cards**: Interactive visualization of policy assignments with an intuitive card-based interface.
- **Azure Integration**: Seamlessly fetch and work with existing Azure Policies and Initiatives.
- **Schema Validation**: Built-in JSON schema validation for policy assignments, definitions, and set definitions.
- **GitHub Integration**: Compare and update policy files from the official ALZ repository.

## Commands

The extension provides several commands through the Explorer and Command Palette (Ctrl+Shift+P):

- `ePacMan: Generate Policy Assignment`: Generate a new policy assignment from a local policy definition
- `ePacMan: Generate Policy Assignment from Azure`: Generate a new policy assignment from an Azure policy definition
- `ePacMan: View Policy Card`: Display a visual card view of policy assignment files
- `ePacMan: Validate Current File`: Validate the current policy file against schema and EPAC rules
- `ePacMan: Compare with ALZ GitHub Version`: Compare the current policy file with the latest version from ALZ GitHub
- `ePacMan: Update from ALZ GitHub Version`: Update the current policy file with the latest version from ALZ GitHub

## Features in Detail

### Policy Assignment Generation
- Generate policy assignments from policy definitions
- Automatic parameter extraction and template generation
- Support for both individual policies and policy initiatives (sets)

### Visual Policy Cards
- Interactive card-based visualization of policy assignments
- Quick access to policy details, parameters, and scope information

![card-view](https://raw.githubusercontent.com/Hardstl/ePacMan/main/media/card-view.png)

### Validation
- Real-time validation against EPAC schemas
- Custom validation rules for Azure Policy best practices

### Azure Integration
- Fetch existing policies from Azure
- Import Azure policies as EPAC assignments
- Support for both built-in and custom policies

**Requirements:**
- `Az.Accounts`: Checks for an active context.
- `Az.Resources`: Used to fetch policies using `Get-AzPolicyDefinition` and `Get-AzPolicySetDefinition`

![policy-assignment-from-azure-policy](https://raw.githubusercontent.com/Hardstl/ePacMan/main/media/policy-assignment-from-azure-policy.png)

### GitHub Integration
- Compare your policy files with the latest versions from Azure Landing Zones (ALZ) GitHub repository
- Identify discrepancies between local policy files and official templates
- Update local policy files with the latest changes from the ALZ repository
- Stay current with best practices and latest policy definitions
- Uses a normalized view for comparisons that ignores non-functional differences like formatting, property order, and metadata to highlight only meaningful changes

![github-comparison](https://raw.githubusercontent.com/Hardstl/ePacMan/main/media/github-comparison.png)

## License

This project is licensed under the MIT License.