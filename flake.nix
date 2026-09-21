{
  description = "matrix-mcp-go: A high-performance, universal Matrix MCP server in Go";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            go
            gopls
            gotools
            golangci-lint
            sqlite
            pkg-config
            gcc
          ];

          env = {
            CGO_ENABLED = "1";
          };
        };

        packages.default = pkgs.buildGoModule {
          pname = "matrix-mcp-go";
          version = "0.1.0";
          src = ./.;
          vendorHash = "sha256-wu3jpDmo7gP+RV7v1HmNkosiaOOulInCJRW8CeLd83w=";
          tags = [ "goolm" ];
          env = {
            CGO_ENABLED = "1";
          };
          buildInputs = with pkgs; [ sqlite ];
          nativeBuildInputs = with pkgs; [ pkg-config ];
        };

        packages.matrix-mcp-go = self.packages.${system}.default;
      });
}
