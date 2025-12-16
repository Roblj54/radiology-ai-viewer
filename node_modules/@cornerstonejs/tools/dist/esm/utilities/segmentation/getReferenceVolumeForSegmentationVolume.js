import { cache } from '@cornerstonejs/core';
export function getReferenceVolumeForSegmentationVolume(segmentationVolumeId) {
    const segmentationVolume = cache.getVolume(segmentationVolumeId);
    if (!segmentationVolume) {
        return null;
    }
    const referencedVolumeId = segmentationVolume.referencedVolumeId;
    let imageVolume;
    if (referencedVolumeId) {
        imageVolume = cache.getVolume(referencedVolumeId);
    }
    else {
        const imageIds = segmentationVolume.imageIds;
        const image = cache.getImage(imageIds[0]);
        const referencedImageId = image.referencedImageId;
        const volumeInfo = cache.getVolumeContainingImageId(referencedImageId);
        imageVolume = volumeInfo?.volume;
    }
    return imageVolume;
}
