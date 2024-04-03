{
  description = "portkey";

#  nixConfig = {
#    extra-substituters = "https://nixpkgs-terraform.cachix.org";
#    extra-trusted-public-keys = "nixpkgs-terraform.cachix.org-1:8Sit092rIdAVENA3ZVeH9hzSiqI/jng6JiCrQ1Dmusw=";
#  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.11";
    flake-utils.url = "github:numtide/flake-utils";
   # nixpkgs-terraform.url = "github:stackbuilders/nixpkgs-terraform";

  };

  outputs = { self, nixpkgs, flake-utils}: #nixpkgs-terraform 
    flake-utils.lib.eachDefaultSystem (system:
      let
        # TODO remove unfree after removing Terraform
        # (Source: https://xeiaso.net/blog/notes/nix-flakes-terraform-unfree-fix)
        pkgs = import nixpkgs {
          inherit system;
          #overlays = [ nixpkgs-terraform.overlays.default ];
          config.allowUnfree = true;
        };
      in
      with pkgs;
      {
        devShells.default = mkShell {
          packages = [
            ansible
            ansible-lint
            bmake
            diffutils
            docker
            docker-compose_1 # TODO upgrade to version 2
            dyff
            git
            go
            gotestsum
            iproute2
            jq
            k9s
            kanidm
            kube3d
            kubectl
            kubernetes-helm
            kustomize
            libisoburn
            neovim
            openssh
            p7zip
            pre-commit
            shellcheck
            #terraform-versions."1.6.4" # TODO replace with OpenTofu, Terraform is no longer FOSS
            terraform
            yamllint

            (python3.withPackages (p: with p; [
              jinja2
              kubernetes
              mkdocs-material
              netaddr
              pexpect
              rich
            ]))
          ];
        };
      }
    );
}
