#!/bin/sh

bash -c "source .cephrc && $(wget -qLO - https://raw.githubusercontent.com/rook/rook/release-1.10/deploy/examples/import-external-cluster.sh)"
VALUES="values-seed.yaml"

#kubectl get ingress gitea --namespace gitea \
 #   || VALUES="values-seed.yaml"

helm template \
    --include-crds \
    --namespace argocd \
    --values "${VALUES}" \
    argocd . \
    | kubectl apply -n argocd -f -