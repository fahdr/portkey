.POSIX:
.PHONY: *
.EXPORT_ALL_VARIABLES:

KUBECONFIG = $(shell pwd)/metal/kubeconfig.yaml
KUBE_CONFIG_PATH = $(KUBECONFIG)

default: metal bootstrap external

configure:
	./scripts/configure
	git status

metal:
	make -C metal

bootstrap:
	make -C bootstrap

external:
	make -C external

post-install:
	@./scripts/hacks

test:
	make -C test

tools:
	@docker run \
		--rm \
		--interactive \
		--tty \
		--network host \
		--env "KUBECONFIG=${KUBECONFIG}" \
		--env "NIXPKGS_ALLOW_UNFREE=1" \
		--volume "/var/run/docker.sock:/var/run/docker.sock" \
		--volume $(shell pwd):$(shell pwd) \
		--volume ${HOME}/.ssh:/root/.ssh \
		--volume ${HOME}/.terraform.d:/root/.terraform.d \
		--volume portkey-tools-cache:/root/.cache \
		--volume portkey-tools-nix:/nix \
		--workdir $(shell pwd) \
		docker.io/nixos/nix sh -c "env NIXPKGS_ALLOW_UNFREE=1 NIXPKGS_ALLOW_INSECURE=1 nix --experimental-features 'nix-command flakes' develop --impure"

docs:
	mkdocs serve

git-hooks:
	pre-commit install
