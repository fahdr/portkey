include githubsecret.env
export
.POSIX:

default: namespace github argocd root

namespace:
	kubectl create namespace argocd --dry-run=client --output=yaml \
		| kubectl apply -f -

# create github secret
github:
	cd argocd && ./apply-github-secret.sh
.PHONY: argocd
argocd:
	cd argocd && ./apply.sh

.PHONY: root
root:
	cd root && ./apply.sh
