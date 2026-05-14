import type { BuildResult } from '../../../../../src/shared/model/agent-build-strategy.model';

export function normalizeExistingImage(imageReference: string): BuildResult {
  const slashIndex = imageReference.indexOf('/');
  const imagePath = slashIndex >= 0 ? imageReference.slice(slashIndex + 1) : imageReference;
  const registry = slashIndex >= 0 ? imageReference.slice(0, slashIndex) : '';
  const tagIndex = imagePath.lastIndexOf(':');
  return {
    image: {
      registry,
      repository: tagIndex > 0 ? imagePath.slice(0, tagIndex) : imagePath,
      tag: tagIndex > 0 ? imagePath.slice(tagIndex + 1) : undefined,
    },
    imageReference,
    strategy: 'existing-image',
    sourceProvenance: imageReference,
    cacheHit: false,
  };
}
