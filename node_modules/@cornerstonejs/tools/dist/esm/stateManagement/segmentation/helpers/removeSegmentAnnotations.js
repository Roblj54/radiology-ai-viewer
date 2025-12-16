import { getAnnotation } from '../../annotation/annotationState';
import { getAnnotationsUIDMapFromSegmentation, removeCompleteContourAnnotation, } from '../utilities';
import { isContourSegmentationAnnotation } from '../../../utilities/contourSegmentation';
export function removeContourSegmentAnnotations(segmentationId, segmentIndex) {
    const annotationUIDsMap = getAnnotationsUIDMapFromSegmentation(segmentationId);
    if (!annotationUIDsMap) {
        return;
    }
    const annotationUIDs = annotationUIDsMap.get(segmentIndex);
    if (!annotationUIDs) {
        return;
    }
    annotationUIDs.forEach((annotationUID) => {
        const annotation = getAnnotation(annotationUID);
        if (isContourSegmentationAnnotation(annotation)) {
            removeCompleteContourAnnotation(annotation);
        }
    });
}
