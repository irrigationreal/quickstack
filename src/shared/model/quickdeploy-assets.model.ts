export const QUICKDEPLOY_ASSETS = [
    { path: 'SKILL.md', contentType: 'text/markdown; charset=utf-8' },
    { path: 'bin/quickstack.mjs', contentType: 'text/javascript; charset=utf-8' },
    { path: 'scripts/config.mjs', contentType: 'text/javascript; charset=utf-8' },
    { path: 'scripts/detect.mjs', contentType: 'text/javascript; charset=utf-8' },
    { path: 'scripts/package.mjs', contentType: 'text/javascript; charset=utf-8' },
    { path: 'scripts/quickstack-api.mjs', contentType: 'text/javascript; charset=utf-8' },
] as const;

export const QUICKDEPLOY_ASSET_PATHS = QUICKDEPLOY_ASSETS.map(asset => asset.path);
export const QUICKDEPLOY_ASSET_CONTENT_TYPES = new Map<string, string>(
    QUICKDEPLOY_ASSETS.map(asset => [asset.path, asset.contentType])
);
