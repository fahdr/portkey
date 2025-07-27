# Feature Branch Testing with ArgoCD

This repository includes tools for testing applications from feature branches without affecting the production deployments on the `master` branch.

## Methods Available

### 1. GitHub Actions (Recommended)

The easiest way to test feature branches is using the GitHub Action workflow.

#### How to Use

1. **Go to your GitHub repository**
2. **Navigate to Actions → Deploy Feature App for Testing**
3. **Click "Run workflow"**
4. **Fill in the parameters:**
   - **App name**: Name of the app from the `apps/` directory (e.g., `nextcloud`, `jellyfin`)
   - **Branch name**: The branch you want to test (e.g., `feature/new-config`)
   - **Action**: Choose `deploy` to create or `cleanup` to remove
   - **Namespace suffix** (optional): Add a suffix for multiple parallel tests
   - **Force cleanup** (optional): Remove finalizers if resources are stuck during cleanup

#### Example Workflow

```yaml
# Deploy nextcloud from feature branch
App name: nextcloud
Branch name: feature/improved-config
Action: deploy
Namespace suffix: test1

# This creates:
# - ArgoCD Application: dev-nextcloud-test1-feature-improved-config
# - Kubernetes Namespace: dev-nextcloud-test1
```

#### Benefits

- ✅ Easy web UI interface
- ✅ Automatic validation
- ✅ Detailed deployment summaries
- ✅ Built-in cleanup functionality
- ✅ Integration with GitHub's security model

### 2. Local Scripts

For developers who prefer command-line tools or need to test locally.

#### Deploy an App

```bash
# Basic deployment
./scripts/deploy-feature-app.sh <app-name> <branch-name>

# With namespace suffix for parallel testing
./scripts/deploy-feature-app.sh <app-name> <branch-name> <suffix>

# Examples
./scripts/deploy-feature-app.sh nextcloud feature/new-config
./scripts/deploy-feature-app.sh jellyfin dev-branch test1
```

#### Clean Up

```bash
# Clean up specific deployment
./scripts/cleanup-feature-app.sh <app-name> <branch-name> [suffix] [--force]

# Examples
./scripts/cleanup-feature-app.sh nextcloud feature/new-config
./scripts/cleanup-feature-app.sh jellyfin dev-branch test1

# Force cleanup when resources are stuck with finalizers
./scripts/cleanup-feature-app.sh nextcloud feature/new-config --force

# List all test applications for an app
./scripts/cleanup-feature-app.sh nextcloud

# Nuclear option: clean up ALL test deployments (use with extreme caution)
./scripts/force-cleanup-all-test-apps.sh --confirm
```

### 3. ArgoCD Development ApplicationSet (Advanced)

For automatic deployment of apps using marker files:

```bash
# Deploy the ApplicationSet
kubectl apply -k system/argocd-dev/

# Mark specific apps for auto-deployment by creating marker files
touch apps/nextcloud/.deploy-to-dev
touch apps/jellyfin/.deploy-to-dev

# Commit and push - only these apps will auto-deploy on feature branches
git add apps/nextcloud/.deploy-to-dev apps/jellyfin/.deploy-to-dev
git commit -m "Enable auto-deploy for nextcloud and jellyfin"
git push origin feature/my-test-branch
```

#### How it Works

- The ApplicationSet monitors all `feature/*` branches
- Only deploys apps that have a `.deploy-to-dev` marker file
- Creates applications named `dev-{app-name}-{branch}`
- Deploys to namespaces named `dev-{app-name}`
- No automatic sync/prune for safety during testing

#### When to Use Each Method

| Method | Best For | Control Level |
|--------|----------|---------------|
| **GitHub Actions** | One-off testing, specific deployments | Complete manual control |
| **ApplicationSet + Marker Files** | Apps you test regularly, CI integration | Semi-automatic with explicit opt-in |

## Understanding the Naming Convention

### Application Names
- Format: `dev-{app-name}-[{suffix}-]{sanitized-branch}`
- Example: `dev-nextcloud-test1-feature-new-config`

### Namespace Names
- Format: `dev-{app-name}[-{suffix}]`
- Example: `dev-nextcloud-test1`

### Branch Sanitization
- Branches are sanitized for Kubernetes naming: `feature/new-config` → `feature-new-config`
- All characters except alphanumeric are replaced with hyphens
- Converted to lowercase

## Monitoring Your Test Deployments

### View All Test Applications
```bash
kubectl get applications -n argocd -l app.kubernetes.io/instance=dev
```

### Check Application Status
```bash
kubectl get application <app-instance-name> -n argocd
argocd app get <app-instance-name>
```

### View Resources in Test Namespace
```bash
kubectl get all -n <namespace>
kubectl logs -n <namespace> -l app.kubernetes.io/name=<app-name>
```

### Access Test Applications
```bash
# Port forward to access locally
kubectl port-forward -n <namespace> svc/<service-name> 8080:80

# Check ingress (if configured)
kubectl get ingress -n <namespace>
```

## Best Practices

### 1. Namespace Isolation
- Test deployments use `dev-` prefixed namespaces
- No interference with production deployments
- Easy identification and cleanup

### 2. Resource Management
- Test applications have automated sync disabled
- No auto-pruning to prevent accidental deletions
- Manual control over deployment lifecycle

### 3. Parallel Testing
- Use namespace suffixes for multiple tests of the same app
- Each test gets its own isolated environment
- Example: `test1`, `test2`, `pr123`

### 4. Clean Up
- Always clean up test deployments when done
- Use the cleanup tools or GitHub Action
- Prevents resource waste and namespace clutter

## GitHub Repository Setup

To use the GitHub Action, ensure your repository has:

### Required Secrets

1. **`KUBECONFIG`**: Base64-encoded kubeconfig file
   ```bash
   cat ~/.kube/config | base64 -w 0
   ```

### Setting Up the Secret

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `KUBECONFIG`
5. Value: Your base64-encoded kubeconfig

## Troubleshooting

### Common Issues

1. **Application stuck in "Progressing"**
   ```bash
   # Check application events
   kubectl describe application <app-instance> -n argocd
   
   # Check namespace events
   kubectl get events -n <namespace>
   ```

2. **Permission issues**
   ```bash
   # Ensure kubeconfig has proper permissions
   kubectl auth can-i create applications --namespace=argocd
   ```

3. **Resource conflicts**
   ```bash
   # Check for existing resources
   kubectl get all -n <namespace>
   
   # Force sync if needed
   argocd app sync <app-instance> --force
   ```

4. **Namespace stuck in "Terminating" state**
   ```bash
   # Check what's preventing deletion
   kubectl get all -n <namespace>
   kubectl describe namespace <namespace>
   
   # Use force cleanup
   ./scripts/cleanup-feature-app.sh <app-name> <branch-name> --force
   
   # Or via GitHub Action with "Force cleanup" enabled
   ```

5. **Resources stuck with finalizers**
   ```bash
   # Check for finalizers
   kubectl get <resource> -n <namespace> -o yaml | grep finalizers -A 5
   
   # Manual finalizer removal (use with caution)
   kubectl patch <resource> -n <namespace> --type json --patch='[{"op": "remove", "path": "/metadata/finalizers"}]'
   
   # Or use the force cleanup scripts
   ```

6. **Nuclear cleanup when everything is stuck**
   ```bash
   # Last resort: clean up ALL test deployments
   ./scripts/force-cleanup-all-test-apps.sh --confirm
   ```

### Getting Help

1. Check ArgoCD UI for detailed status
2. Review application logs in the target namespace
3. Verify the source branch exists and contains the expected changes
4. Ensure the Helm chart in your app directory is valid

## Security Considerations

- Test deployments use the same security context as production
- Secrets and ConfigMaps are isolated per namespace
- Network policies (if any) apply to test namespaces
- Consider using different ingress domains for test deployments
