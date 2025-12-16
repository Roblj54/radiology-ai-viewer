import { cache, Enums, convertMapperToNotSharedMapper, volumeLoader, eventTarget, createVolumeActor, } from '@cornerstonejs/core';
import { Events, SegmentationRepresentations } from '../../../enums';
import { getSegmentation } from '../../../stateManagement/segmentation/getSegmentation';
const internalCache = new Map();
const load = ({ cfun, ofun, actor }) => {
    actor.getProperty().setRGBTransferFunction(1, cfun);
    actor.getProperty().setScalarOpacity(1, ofun);
};
export async function addVolumesAsIndependentComponents({ viewport, volumeInputs, segmentationId, }) {
    const defaultActor = viewport.getDefaultActor();
    const { actor } = defaultActor;
    const { uid, callback } = defaultActor;
    const referenceVolumeId = viewport.getVolumeId();
    if (internalCache.get(uid)?.added) {
        return {
            uid,
            actor,
        };
    }
    const volumeInputArray = volumeInputs;
    const firstImageVolume = cache.getVolume(volumeInputArray[0].volumeId);
    if (!firstImageVolume) {
        throw new Error(`imageVolume with id: ${firstImageVolume.volumeId} does not exist`);
    }
    const { volumeId } = volumeInputArray[0];
    const segImageVolume = await volumeLoader.loadVolume(volumeId);
    if (!segImageVolume) {
        throw new Error(`segImageVolume with id: ${segImageVolume.volumeId} does not exist`);
    }
    const segVoxelManager = segImageVolume.voxelManager;
    const segData = segVoxelManager.getCompleteScalarDataArray();
    const { imageData: segImageData } = segImageVolume;
    const baseVolume = cache.getVolume(referenceVolumeId);
    const baseVoxelManager = baseVolume.voxelManager;
    const baseData = baseVoxelManager.getCompleteScalarDataArray();
    const newComp = 2;
    const cubeData = new Float32Array(newComp * baseVolume.voxelManager.getScalarDataLength());
    const dims = segImageData.getDimensions();
    for (let z = 0; z < dims[2]; ++z) {
        for (let y = 0; y < dims[1]; ++y) {
            for (let x = 0; x < dims[0]; ++x) {
                const iTuple = x + dims[0] * (y + dims[1] * z);
                cubeData[iTuple * newComp + 0] = baseData[iTuple];
                cubeData[iTuple * newComp + 1] = segData[iTuple];
            }
        }
    }
    viewport.removeActors([uid]);
    const oldMapper = actor.getMapper();
    const mapper = convertMapperToNotSharedMapper(oldMapper);
    actor.setMapper(mapper);
    mapper.setBlendMode(Enums.BlendModes.LABELMAP_EDGE_PROJECTION_BLEND);
    const arrayAgain = mapper.getInputData().getPointData().getArray(0);
    arrayAgain.setData(cubeData);
    arrayAgain.setNumberOfComponents(2);
    actor.getProperty().setColorMixPreset(1);
    actor.getProperty().setForceNearestInterpolation(1, true);
    actor.getProperty().setIndependentComponents(true);
    viewport.addActor({
        actor,
        uid,
        callback,
        referencedId: referenceVolumeId,
        representationUID: `${segmentationId}-${SegmentationRepresentations.Labelmap}`,
    });
    internalCache.set(uid, {
        added: true,
        segmentationRepresentationUID: `${segmentationId}`,
        originalBlendMode: viewport.getBlendMode(),
    });
    actor.set({
        preLoad: load,
    });
    function onSegmentationDataModified(evt) {
        const { segmentationId } = evt.detail;
        const { representationData } = getSegmentation(segmentationId);
        const { volumeId: segVolumeId } = representationData.Labelmap;
        if (segVolumeId !== segImageVolume.volumeId) {
            return;
        }
        const segmentationVolume = cache.getVolume(segVolumeId);
        const segVoxelManager = segmentationVolume.voxelManager;
        const imageData = mapper.getInputData();
        const array = imageData.getPointData().getArray(0);
        const baseData = array.getData();
        const newComp = 2;
        const dims = segImageData.getDimensions();
        const slices = Array.from({ length: dims[2] }, (_, i) => i);
        for (const z of slices) {
            for (let y = 0; y < dims[1]; ++y) {
                for (let x = 0; x < dims[0]; ++x) {
                    const iTuple = x + dims[0] * (y + dims[1] * z);
                    baseData[iTuple * newComp + 1] = segVoxelManager.getAtIndex(iTuple);
                }
            }
        }
        array.setData(baseData);
        imageData.modified();
        viewport.render();
    }
    eventTarget.addEventListenerDebounced(Events.SEGMENTATION_DATA_MODIFIED, onSegmentationDataModified, 200);
    eventTarget.addEventListener(Events.SEGMENTATION_REPRESENTATION_REMOVED, async (evt) => {
        eventTarget.removeEventListener(Events.SEGMENTATION_DATA_MODIFIED, onSegmentationDataModified);
        const actorEntry = viewport.getActor(uid);
        const { element, id } = viewport;
        viewport.removeActors([uid]);
        const actor = await createVolumeActor({
            volumeId: uid,
            blendMode: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
            callback: ({ volumeActor }) => {
                if (actorEntry.callback) {
                    actorEntry.callback({
                        volumeActor,
                        volumeId,
                    });
                }
            },
        }, element, id);
        viewport.addActor({ actor, uid });
        viewport.render();
    });
    return {
        uid,
        actor,
    };
}
