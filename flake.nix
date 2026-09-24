{
  description = "pi-matrix: Native Matrix & Telegram Bridge Extensions for Pi Coding Agent";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages = {
          matrix = pkgs.stdenv.mkDerivation {
            pname = "pi-extension-matrix";
            version = "1.0.0";
            src = ./matrix;
            installPhase = ''
              mkdir -p $out
              cp -r ./* $out/
            '';
          };

          telegram = pkgs.stdenv.mkDerivation {
            pname = "pi-extension-telegram";
            version = "1.0.0";
            src = ./telegram;
            installPhase = ''
              mkdir -p $out
              cp -r ./* $out/
            '';
          };

          default = pkgs.stdenv.mkDerivation {
            pname = "pi-matrix";
            version = "1.0.0";
            src = ./.;
            installPhase = ''
              mkdir -p $out
              cp -r ./* $out/
            '';
          };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            typescript
            prettier
          ];
        };
      }
    );
}
