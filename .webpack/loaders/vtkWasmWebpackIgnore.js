// Kitware uses `/* @vite-ignore */` on dynamic import(url).
// Rspack/webpack still rewrite those imports unless `webpackIgnore: true`
// is present, which breaks blob: and absolute URL loads of the WASM glue.
module.exports = function vtkWasmWebpackIgnoreLoader(source) {
  return source.replace(/\/\*\s*@vite-ignore\s*\*\//g, '/* webpackIgnore: true */');
};
