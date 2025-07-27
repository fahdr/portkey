#!/bin/bash
# Notification script for dnf-automatic
# This runs after dnf-automatic installs updates

HOSTNAME=$(hostname)
NTFY_TOPIC="${NTFY_TOPIC:-portkey_a8sd7fkjxlkcjasdw33813}"
NTFY_URL="https://ntfy.sh"

# Check if reboot is required
if [ -f /sentinel/reboot-required ]; then
    MESSAGE="🔄 Security updates installed on $HOSTNAME. Reboot scheduled by kured."
    PRIORITY="4"
    TAGS="warning,gear"
else
    MESSAGE="✅ Security updates installed on $HOSTNAME. No reboot required."
    PRIORITY="2"
    TAGS="tada,gear"
fi

# Send notification to ntfy
curl -s \
    -H "Title: Cluster Updates" \
    -H "Priority: $PRIORITY" \
    -H "Tags: $TAGS" \
    -d "$MESSAGE" \
    "$NTFY_URL/$NTFY_TOPIC" || true
