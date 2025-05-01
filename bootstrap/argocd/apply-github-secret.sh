# scripts/apply-github-secret.sh
#!/bin/bash
set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN environment variable is not set"
  echo "Please create a Personal Access Token with 'repo' scope at https://github.com/settings/tokens"
  echo "Then run: GITHUB_TOKEN=your-token ./scripts/apply-github-secret.sh"
  exit 1
fi

# Replace token placeholder and apply
cat github-secret.yaml | sed "s|\${GITHUB_TOKEN}|$GITHUB_TOKEN|g" | kubectl apply -f -
echo "GitHub repository credentials secret applied successfully"