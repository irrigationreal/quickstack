export const QUICKSTACK_ASSETS = [
    { path: 'SKILL.md', contentType: 'text/markdown; charset=utf-8' },
] as const;

export const QUICKSTACK_ASSET_PATHS = QUICKSTACK_ASSETS.map(asset => asset.path);
export const QUICKSTACK_ASSET_CONTENT_TYPES = new Map<string, string>(
    QUICKSTACK_ASSETS.map(asset => [asset.path, asset.contentType])
);

export const QUICKDEPLOY_ASSETS = QUICKSTACK_ASSETS;
export const QUICKDEPLOY_ASSET_PATHS = QUICKSTACK_ASSET_PATHS;
export const QUICKDEPLOY_ASSET_CONTENT_TYPES = QUICKSTACK_ASSET_CONTENT_TYPES;
