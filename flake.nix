{
  description = "mc-worldgen: World generation for the nerima-games Minecraft-clone rebuild: biome classification, deterministic terrain, carvers, vegetation, structures, chunk lifecycle and the light grid. No renderer, ever.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    #
    # flake.lock is pinned to rev 624af665 (2026-07-26) rather than the
    # channel head: every revision from 2026-08-28 onward ships oxlint
    # >=1.79.0, whose `no-redeclare` rule false-positives on the `type X` /
    # `const X = Brand.refined<X>(...)` branded-type idiom used throughout
    # src/domain (proven by A/B testing oxlint 1.75.0 vs 1.79.0). Re-check on
    # the next bump.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # Only what is actually exercised: x86_64-linux by CI, aarch64-darwin by
      # the maintainer. Declaring a platform nothing builds makes
      # `nix flake check --all-systems` fail rather than skip it.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # Node 24 matches the `engines` field and the CI runner. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint is the opposite case: it is NOT a package.json devDependency.
          # It used to be, and every repo in the org independently drifted onto
          # a different version (some on 0.12.x, some on 1.76.x) without anyone
          # noticing, because the config file (`.oxlintrc.json`) had a filename
          # bug that meant it was never actually being loaded either way — see
          # DEPENDENCY_POLICY.md §5's "前提条件" note. Once that bug was fixed,
          # a single pinned Nix-provided oxlint became the one source of truth
          # instead of 16 independently-drifting npm pins.
          #
          # ast-grep covers what oxlint cannot: it implements none of
          # no-restricted-syntax, no-restricted-properties or
          # no-restricted-globals, so structural checks like the type-assertion
          # and wall-clock-read bans (`.ast-grep/rules/`) have no other
          # mechanical gate.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.corepack_24
              pkgs.typescript-language-server
              pkgs.oxlint
              pkgs.ast-grep
            ];

            shellHook = ''
              corepackDir="$(mktemp -d "''${TMPDIR:-/tmp}/mc-worldgen-corepack.XXXXXX")"
              corepack enable --install-directory "$corepackDir"
              export PATH="$corepackDir:$PATH"
            '';
          };
        }
      );
    };
}
