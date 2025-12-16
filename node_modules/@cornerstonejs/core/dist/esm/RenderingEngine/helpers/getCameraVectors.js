import * as metaData from '../../metaData';
import * as CONSTANTS from '../../constants';
import * as Enums from '../../enums';
import { vec3 } from 'gl-matrix';
const { MPR_CAMERA_VALUES } = CONSTANTS;
const { OrientationAxis } = Enums;
export function calculateCameraPosition(rowCosineVec, colCosineVec, scanAxisNormal, orientation) {
    let referenceCameraValues;
    switch (orientation) {
        case OrientationAxis.AXIAL:
        case OrientationAxis.AXIAL_REFORMAT:
            referenceCameraValues = MPR_CAMERA_VALUES.axial;
            break;
        case OrientationAxis.SAGITTAL:
        case OrientationAxis.SAGITTAL_REFORMAT:
            referenceCameraValues = MPR_CAMERA_VALUES.sagittal;
            break;
        case OrientationAxis.CORONAL:
        case OrientationAxis.CORONAL_REFORMAT:
            referenceCameraValues = MPR_CAMERA_VALUES.coronal;
            break;
        default:
            referenceCameraValues = MPR_CAMERA_VALUES.axial;
            break;
    }
    const normalizedRowCosine = vec3.normalize(vec3.create(), rowCosineVec);
    const normalizedColCosine = vec3.normalize(vec3.create(), colCosineVec);
    const normalizedScanAxis = vec3.normalize(vec3.create(), scanAxisNormal);
    const inputVectors = [
        normalizedRowCosine,
        normalizedColCosine,
        normalizedScanAxis,
    ];
    const referenceVectors = [
        vec3.fromValues(referenceCameraValues.viewRight[0], referenceCameraValues.viewRight[1], referenceCameraValues.viewRight[2]),
        vec3.fromValues(referenceCameraValues.viewUp[0], referenceCameraValues.viewUp[1], referenceCameraValues.viewUp[2]),
        vec3.fromValues(referenceCameraValues.viewPlaneNormal[0], referenceCameraValues.viewPlaneNormal[1], referenceCameraValues.viewPlaneNormal[2]),
    ];
    const usedInputIndices = new Set();
    const findBestMatch = (refVector) => {
        let bestMatch = 0;
        let bestDot = -2;
        let shouldInvert = false;
        inputVectors.forEach((inputVec, index) => {
            if (usedInputIndices.has(index)) {
                return;
            }
            const dot = vec3.dot(refVector, inputVec);
            const absDot = Math.abs(dot);
            if (absDot > bestDot) {
                bestDot = absDot;
                bestMatch = index;
                shouldInvert = dot < 0;
            }
        });
        usedInputIndices.add(bestMatch);
        const matchedVector = vec3.clone(inputVectors[bestMatch]);
        if (shouldInvert) {
            vec3.negate(matchedVector, matchedVector);
        }
        return matchedVector;
    };
    const viewRight = findBestMatch(referenceVectors[0]);
    const viewUp = findBestMatch(referenceVectors[1]);
    const viewPlaneNormal = findBestMatch(referenceVectors[2]);
    return {
        viewPlaneNormal: [
            viewPlaneNormal[0],
            viewPlaneNormal[1],
            viewPlaneNormal[2],
        ],
        viewUp: [viewUp[0], viewUp[1], viewUp[2]],
        viewRight: [viewRight[0], viewRight[1], viewRight[2]],
    };
}
export function getCameraVectors(viewport, config) {
    if (!viewport.getActors()?.length) {
        return;
    }
    if (viewport.type !== Enums.ViewportType.ORTHOGRAPHIC) {
        console.warn('Viewport should be a volume viewport');
    }
    let imageId = viewport.getCurrentImageId();
    if (!imageId) {
        imageId = viewport.getImageIds()?.[0];
    }
    if (!imageId) {
        return;
    }
    const { imageOrientationPatient } = metaData.get('imagePlaneModule', imageId);
    const rowCosineVec = vec3.fromValues(imageOrientationPatient[0], imageOrientationPatient[1], imageOrientationPatient[2]);
    const colCosineVec = vec3.fromValues(imageOrientationPatient[3], imageOrientationPatient[4], imageOrientationPatient[5]);
    const scanAxisNormal = vec3.cross(vec3.create(), rowCosineVec, colCosineVec);
    let { orientation } = config || {};
    const { useViewportNormal } = config || {};
    let normalPlaneForOrientation = scanAxisNormal;
    if (useViewportNormal) {
        normalPlaneForOrientation = viewport.getCamera().viewPlaneNormal;
    }
    if (!orientation) {
        orientation = getOrientationFromScanAxisNormal(normalPlaneForOrientation);
    }
    return calculateCameraPosition(rowCosineVec, colCosineVec, scanAxisNormal, orientation);
}
export function getOrientationFromScanAxisNormal(scanAxisNormal) {
    const normalizedScanAxis = vec3.normalize(vec3.create(), scanAxisNormal);
    const axialNormal = vec3.fromValues(MPR_CAMERA_VALUES.axial.viewPlaneNormal[0], MPR_CAMERA_VALUES.axial.viewPlaneNormal[1], MPR_CAMERA_VALUES.axial.viewPlaneNormal[2]);
    const sagittalNormal = vec3.fromValues(MPR_CAMERA_VALUES.sagittal.viewPlaneNormal[0], MPR_CAMERA_VALUES.sagittal.viewPlaneNormal[1], MPR_CAMERA_VALUES.sagittal.viewPlaneNormal[2]);
    const coronalNormal = vec3.fromValues(MPR_CAMERA_VALUES.coronal.viewPlaneNormal[0], MPR_CAMERA_VALUES.coronal.viewPlaneNormal[1], MPR_CAMERA_VALUES.coronal.viewPlaneNormal[2]);
    const axialDot = Math.abs(vec3.dot(normalizedScanAxis, axialNormal));
    const sagittalDot = Math.abs(vec3.dot(normalizedScanAxis, sagittalNormal));
    const coronalDot = Math.abs(vec3.dot(normalizedScanAxis, coronalNormal));
    if (axialDot >= sagittalDot && axialDot >= coronalDot) {
        return OrientationAxis.AXIAL;
    }
    else if (sagittalDot >= coronalDot) {
        return OrientationAxis.SAGITTAL;
    }
    else {
        return OrientationAxis.CORONAL;
    }
}
