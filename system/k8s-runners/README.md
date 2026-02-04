# GitHub Actions Self-Hosted Runners

This chart deploys self-hosted GitHub Actions runners in Kubernetes using the Actions Runner Controller (ARC).

## Prerequisites

1. The `actions-runner-controller` chart must be deployed first
2. A GitHub App configured for your organization

## GitHub App Setup

### 1. Create a GitHub App

1. Go to your GitHub organization settings: `https://github.com/organizations/<ORG>/settings/apps`
2. Click "New GitHub App"
3. Configure the app:
   - **Name**: `ARC Runner Controller` (or any name)
   - **Homepage URL**: Your cluster URL or `https://github.com/<ORG>`
   - **Webhook**: Uncheck "Active" (not needed for ARC)

4. Set permissions:
   - **Repository permissions**:
     - Actions: Read-only
     - Administration: Read & write
     - Checks: Read-only
     - Metadata: Read-only
   - **Organization permissions**:
     - Self-hosted runners: Read & write

5. Click "Create GitHub App"

### 2. Generate Private Key

1. After creating the app, scroll down to "Private keys"
2. Click "Generate a private key"
3. Save the downloaded `.pem` file

### 3. Install the App

1. Go to your app settings and click "Install App"
2. Select your organization
3. Choose "All repositories" or select specific repos
4. Click "Install"

### 4. Get Installation ID

1. After installation, note the URL: `https://github.com/organizations/<ORG>/settings/installations/<INSTALLATION_ID>`
2. The number at the end is your Installation ID

### 5. Store Credentials in Vaultwarden

Create a new item in Vaultwarden with:
- **Name**: `github-app-arc`
- **Custom Fields**:
  - `github_app_id`: The App ID from the app's general settings
  - `github_app_installation_id`: The Installation ID from step 4
  - `github_app_private_key`: The entire contents of the `.pem` file

## Usage in Workflows

Update your workflow files to use self-hosted runners:

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux, x64]
    steps:
      - uses: actions/checkout@v4
      # ... rest of your workflow
```

## Configuration

Edit `values.yaml` to customize:

- `minRunners`: Minimum number of idle runners (0 for scale-to-zero)
- `maxRunners`: Maximum concurrent runners
- Runner resources (CPU/memory limits)
- Docker socket mounting for container builds

## Scaling Behavior

- Runners scale from 0 to `maxRunners` based on pending workflow jobs
- When no jobs are pending, runners scale back to `minRunners`
- New runners are created on-demand when jobs are queued
