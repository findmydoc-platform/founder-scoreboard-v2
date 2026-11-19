import ts from "typescript";
import path from "node:path";

// Both credential and Planning ownership checks use the project's actual paths
// and TypeScript extension substitution, including helpers outside src.
export function createSourceModuleResolver(root) {
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.sys.fileExists(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile) : null;
  const configured = config && !config.error ? ts.parseJsonConfigFileContent(config.config, ts.sys, root).options : {};
  const options = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext, baseUrl: root, paths: { "@/*": ["src/*"] }, ...configured };
  return { relative: file => path.relative(root, file).split(path.sep).join("/"), resolve: (specifier, file) => ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule };
}
