.POSIX:
include argocd/githubsecret.env
export
export KUBECONFIG = $(shell pwd)/../metal/kubeconfig.yaml

default: github bootstrap

github:
	cd argocd && ./apply-github-secret.sh

ceph:
	cd argocd && ./apply-ceph

.PHONY: bootstrap
bootstrap:
	ansible-playbook \
		bootstrap.yml -vv