const fs = require('fs');
const path = require('path');

// Shared module-resolution rules (alias + module search paths) used by BOTH
// build pipelines so they cannot drift apart:
//   - the webpack/rspack build: webpack.base.js -> webpack.pwa.js, plus every
//     per-package webpack.prod.js / webpack.dev.js that merges webpack.base.js
//   - the rsbuild build: rsbuild.config.ts (dev:fast)
//
// Plugin aliases (writePluginImportsFile.getPluginResolveAliases) are NOT
// included here: they depend on pluginConfig.json and are merged in separately
// by each config.
//
// All paths are anchored to this file's location (the repo-root `.webpack/`
// directory), so the values are identical regardless of which package's build
// is doing the resolving.

function resolveSlicerHubClientRoot() {
  // Out-of-tree @slicer-hub/ohif-extension lives under SlicerHub-js-clients.
  // With resolve.symlinks=true, rspack resolves from that real path and often
  // fails to find the app-linked @slicer-hub/client via node_modules walk-up.
  // Prefer the sibling checkout real path (avoids Windows symlink + file-alias
  // issues); fall back to the app-linked package. Alias the package root so
  // package.json exports/mainFields apply (not a direct dist file path).
  const candidates = [
    path.resolve(__dirname, '../../SlicerHub-js-clients/packages/client'),
    path.resolve(__dirname, '../platform/app/node_modules/@slicer-hub/client'),
  ];
  for (const root of candidates) {
    try {
      const realRoot = fs.realpathSync(root);
      const entry = path.join(realRoot, 'dist', 'hub-client.js');
      if (fs.existsSync(entry)) {
        return realRoot;
      }
    } catch {
      // candidate missing or not resolvable
    }
  }
  return null;
}

function resolveSlicerHubFlexrayWebRoot() {
  const candidates = [
    path.resolve(__dirname, '../../SlicerHub-js-clients/packages/flexray-web'),
    path.resolve(
      __dirname,
      '../platform/app/node_modules/@slicer-hub/flexray-web'
    ),
  ];
  for (const root of candidates) {
    try {
      const realRoot = fs.realpathSync(root);
      if (fs.existsSync(path.join(realRoot, 'src', 'index.js'))) {
        return realRoot;
      }
    } catch {
      // skip
    }
  }
  return null;
}

function resolveSlicerHubI18nRoot() {
  const candidates = [
    path.resolve(__dirname, '../../SlicerHub-js-clients/packages/i18n'),
    path.resolve(__dirname, '../platform/app/node_modules/@slicer-hub/i18n'),
  ];
  for (const root of candidates) {
    try {
      const realRoot = fs.realpathSync(root);
      if (fs.existsSync(path.join(realRoot, 'index.ts'))) {
        return realRoot;
      }
    } catch {
      // skip
    }
  }
  return null;
}

const slicerHubClientRoot = resolveSlicerHubClientRoot();
const slicerHubFlexrayWebRoot = resolveSlicerHubFlexrayWebRoot();
const slicerHubI18nRoot = resolveSlicerHubI18nRoot();

const alias = {
  // Some extensions import app-level utilities (e.g. history,
  // preserveQueryParameters) from '@ohif/app'. pnpm's isolated layout does not
  // expose the top-level app package to those extensions, and adding it as a
  // workspace dependency would create an app<->default cycle, so we resolve the
  // bare specifier to the app source here ($ = exact match).
  '@ohif/app$': path.resolve(__dirname, '../platform/app/src/index.js'),
  '@': path.resolve(__dirname, '../platform/app/src'),
  '@components': path.resolve(__dirname, '../platform/app/src/components'),
  '@hooks': path.resolve(__dirname, '../platform/app/src/hooks'),
  '@routes': path.resolve(__dirname, '../platform/app/src/routes'),
  '@state': path.resolve(__dirname, '../platform/app/src/state'),
  ...(slicerHubClientRoot
    ? {
        // Point at the built ESM entry. Aliasing the package root fails in
        // rspack for out-of-tree linked packages ("matched aliased key" but
        // package exports are not applied).
        '@slicer-hub/client$': path.join(
          slicerHubClientRoot,
          'dist',
          'hub-client.js'
        ),
      }
    : {}),
  ...(slicerHubFlexrayWebRoot
    ? {
        '@slicer-hub/flexray-web$': path.join(
          slicerHubFlexrayWebRoot,
          'src',
          'index.js'
        ),
      }
    : {}),
  ...(slicerHubI18nRoot
    ? {
        // Alias both exact ($) and bare forms: rspack sometimes skips `$`
        // when resolving from out-of-tree linked packages, which then hits a
        // nested node_modules copy that babel excludes.
        '@slicer-hub/i18n$': path.join(slicerHubI18nRoot, 'index.ts'),
        '@slicer-hub/i18n': path.join(slicerHubI18nRoot, 'index.ts'),
      }
    : {}),
};

// Directories to search when resolving modules. The leading bare 'node_modules'
// preserves the default importer-relative walk-up, which pnpm's isolated layout
// requires so that transitive deps (e.g. react-remove-scroll -> tslib 2.x)
// resolve to the sibling copy inside .pnpm/<pkg>/node_modules rather than a
// hoisted older version.
const moduleSearchPaths = [
  'node_modules',
  path.resolve(__dirname, '../node_modules'),
  path.resolve(__dirname, '../../../node_modules'),
  path.resolve(__dirname, '../platform/app/node_modules'),
  path.resolve(__dirname, '../platform/ui/node_modules'),
];

// Build the resolve.modules array for a build. `srcDir` is the building
// package's source root; it is appended last (matching the previous inline
// behavior in webpack.base.js). Pass nothing to get just the shared paths.
function getModules(srcDir) {
  return srcDir ? [...moduleSearchPaths, srcDir] : [...moduleSearchPaths];
}

module.exports = { alias, moduleSearchPaths, getModules };
