#!/bin/sh
export NAMESPACE=rook-ceph
export ROOK_EXTERNAL_FSID=3d01e673-493f-4aae-9a00-695ae091a973
export ROOK_EXTERNAL_USERNAME=client.healthchecker
export ROOK_EXTERNAL_CEPH_MON_DATA=shire=192.168.0.2:6789
export ROOK_EXTERNAL_USER_SECRET=AQC2eARmfB1wABAAzWQiyZC5ncgdYSOkB6P18w==
export CSI_RBD_NODE_SECRET=AQC2eARmxh9UARAA2Weq3VUJrYZ/An53/NZLZw==
export CSI_RBD_NODE_SECRET_NAME=csi-rbd-node
export CSI_RBD_PROVISIONER_SECRET=AQC2eARm+YymARAAuFjCSC/WggLiIoGJtV5s6w==
export CSI_RBD_PROVISIONER_SECRET_NAME=csi-rbd-provisioner
export RBD_POOL_NAME=rook
export RGW_POOL_PREFIX=default
VALUES="values-seed.yaml"

#kubectl get ingress gitea --namespace gitea \
 #   || VALUES="values-seed.yaml"

helm template \
    --include-crds \
    --namespace argocd \
    --values "${VALUES}" \
    argocd . \
    | kubectl apply -n argocd -f -