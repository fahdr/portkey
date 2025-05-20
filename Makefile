.POSIX:
.PHONY: *
.EXPORT_ALL_VARIABLES:

KUBECONFIG = $(shell pwd)/metal/kubeconfig.yaml
KUBE_CONFIG_PATH = $(KUBECONFIG)

default: system external smoke-test post-install clean

configure:
	./scripts/configure
	git status

metal:
	make -C metal

system:
	make -C system

external:
	make -C external

smoke-test:
	make -C test filter=Smoke

post-install:
	@./scripts/hacks

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

test:
	make -C test

clean:
	docker compose --project-directory ./metal/roles/pxe_server/files down

# dev:
# 	make -C metal cluster env=dev
# 	make -C bootstrap

docs:
	mkdocs serve

git-hooks:
	pre-commit install
