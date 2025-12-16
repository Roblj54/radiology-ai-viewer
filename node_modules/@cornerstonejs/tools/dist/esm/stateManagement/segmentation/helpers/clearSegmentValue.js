import { cache } from '@cornerstonejs/core';
import { getSegmentation } from '../getSegmentation';
import { triggerSegmentationDataModified } from '../triggerSegmentationEvents';
export function clearSegmentValue(segmentationId, segmentIndex) {
    const segmentation = getSegmentation(segmentationId);
    if (segmentation.representationData.Labelmap) {
        const { representationData } = segmentation;
        const labelmapData = representationData.Labelmap;
        if ('imageIds' in labelmapData || 'volumeId' in labelmapData) {
            const items = 'imageIds' in labelmapData
                ? labelmapData.imageIds.map((imageId) => cache.getImage(imageId))
                : [cache.getVolume(labelmapData.volumeId)];
            items.forEach((item) => {
                if (!item) {
                    return;
                }
                const { voxelManager } = item;
                voxelManager.forEach(({ value, index }) => {
                    if (value === segmentIndex) {
                        voxelManager.setAtIndex(index, 0);
                    }
                });
            });
        }
        triggerSegmentationDataModified(segmentationId);
    }
    else {
        throw new Error('Invalid segmentation type, only labelmap is supported right now');
    }
}
