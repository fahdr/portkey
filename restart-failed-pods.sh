
# Get all pods in all namespaces, excluding those in Running or Completed states
pods=$(kubectl get pods --all-namespaces --field-selector=status.phase!=Running,status.phase!=Completed -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name --no-headers)

# Loop through the list of pods and delete them
while IFS= read -r line; do
    namespace=$(echo "$line" | awk '{print $1}')
    pod=$(echo "$line" | awk '{print $2}')
    echo "Deleting pod $pod in namespace $namespace"
    kubectl delete pod "$pod" --namespace "$namespace"
done <<< "$pods"