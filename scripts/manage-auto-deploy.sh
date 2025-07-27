#!/bin/bash
set -e

# Script to enable/disable automatic deployment for apps
# Usage: ./manage-auto-deploy.sh <enable|disable> <app-name> [app-name2] ...

ACTION="${1}"
shift

if [ -z "$ACTION" ] || [ $# -eq 0 ]; then
    echo "Usage: $0 <enable|disable> <app-name> [app-name2] ..."
    echo ""
    echo "Examples:"
    echo "  $0 enable nextcloud jellyfin     # Enable auto-deploy for nextcloud and jellyfin"
    echo "  $0 disable nextcloud             # Disable auto-deploy for nextcloud"
    echo ""
    echo "Available apps:"
    ls -1 apps/ 2>/dev/null | grep -v "^Chart\|^values" || echo "No apps found"
    echo ""
    echo "Currently enabled for auto-deploy:"
    find apps/ -name ".deploy-to-dev" -exec dirname {} \; 2>/dev/null | sed 's|apps/||' | sort || echo "None"
    exit 1
fi

case "$ACTION" in
    enable)
        for app in "$@"; do
            if [ ! -d "apps/$app" ]; then
                echo "❌ App '$app' not found in apps/ directory"
                continue
            fi
            
            if [ -f "apps/$app/.deploy-to-dev" ]; then
                echo "✅ Auto-deploy already enabled for $app"
            else
                touch "apps/$app/.deploy-to-dev"
                echo "✅ Enabled auto-deploy for $app"
            fi
        done
        ;;
    disable)
        for app in "$@"; do
            if [ -f "apps/$app/.deploy-to-dev" ]; then
                rm "apps/$app/.deploy-to-dev"
                echo "✅ Disabled auto-deploy for $app"
            else
                echo "ℹ️  Auto-deploy already disabled for $app"
            fi
        done
        ;;
    *)
        echo "❌ Invalid action: $ACTION"
        echo "Use 'enable' or 'disable'"
        exit 1
        ;;
esac

echo ""
echo "Currently enabled for auto-deploy:"
find apps/ -name ".deploy-to-dev" -exec dirname {} \; 2>/dev/null | sed 's|apps/||' | sort || echo "None"
echo ""
echo "💡 Don't forget to commit and push the changes:"
echo "  git add apps/*/.deploy-to-dev"
echo "  git commit -m 'Update auto-deploy configuration'"
echo "  git push"
