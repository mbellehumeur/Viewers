import { cache, imageLoadPoolManager, Enums } from '@cornerstonejs/core';
import getCenterSequentialFrames from './getCenterSequentialFrames';
import zip from 'lodash.zip';
import compact from 'lodash.compact';
import flatten from 'lodash.flatten';

// Map of volumeId and SeriesInstanceId
const volumeIdMapsToLoad = new Map<string, string>();
const viewportIdVolumeInputArrayMap = new Map<string, unknown[]>();

/**
 * Caches volumeUIDs until all hanging-protocol volumes are initialized, then
 * reorders each volume's image load requests center-first: middle, then lower
 * half descending, then upper half ascending.
 * @param {Object} props image loading properties from Cornerstone ViewportService
 * @returns
 */
export default function centerSequentialLoader({
  data: { viewportId, volumeInputArray },
  displaySetsMatchDetails,
  viewportMatchDetails: matchDetails,
}) {
  viewportIdVolumeInputArrayMap.set(viewportId, volumeInputArray);

  // Based on the volumeInputs store the volumeIds and SeriesInstanceIds
  // to keep track of the volumes being loaded
  for (const volumeInput of volumeInputArray) {
    const { volumeId } = volumeInput;
    const volume = cache.getVolume(volumeId);

    if (!volume) {
      return;
    }

    // if the volumeUID is not in the volumeUIDs array, add it
    if (!volumeIdMapsToLoad.has(volumeId)) {
      const { metadata } = volume;
      volumeIdMapsToLoad.set(volumeId, metadata.SeriesInstanceUID);
    }
  }

  /**
   * The following is checking if all the viewports that were matched in the HP has been
   * successfully created their cornerstone viewport or not. Todo: This can be
   * improved by not checking it, and as soon as the matched DisplaySets have their
   * volume loaded, we start the loading, but that comes at the cost of viewports
   * not being created yet (e.g., in a 10 viewport ptCT fusion, when one ct viewport and one
   * pt viewport are created we have a guarantee that the volumes are created in the cache
   * but the rest of the viewports (fusion, mip etc.) are not created yet. So
   * we can't initiate setting the volumes for those viewports. One solution can be
   * to add an event when a viewport is created (not enabled element event) and then
   * listen to it and as the other viewports are created we can set the volumes for them
   * since volumes are already started loading.
   */
  const uniqueViewportVolumeDisplaySetUIDs = new Set();
  viewportIdVolumeInputArrayMap.forEach((volumeInputArray, viewportId) => {
    volumeInputArray.forEach(volumeInput => {
      const { volumeId } = volumeInput;
      uniqueViewportVolumeDisplaySetUIDs.add(volumeId);
    });
  });

  const uniqueMatchedDisplaySetUIDs = new Set();

  matchDetails.forEach(matchDetail => {
    const { displaySetsInfo } = matchDetail;
    displaySetsInfo.forEach(({ displaySetInstanceUID }) => {
      uniqueMatchedDisplaySetUIDs.add(displaySetInstanceUID);
    });
  });

  if (uniqueViewportVolumeDisplaySetUIDs.size !== uniqueMatchedDisplaySetUIDs.size) {
    return;
  }

  const volumeIds = Array.from(volumeIdMapsToLoad.keys()).slice();
  // get volumes from cache
  const volumes = volumeIds.map(volumeId => {
    return cache.getVolume(volumeId);
  });

  // iterate over all volumes, and get their imageIds, and reorder
  // center-sequential for later use
  const AllRequests = [];
  volumes.forEach(volume => {
    const requests = volume.getImageLoadRequests?.() ?? [];

    if (!requests.length || !requests[0] || !requests[0].imageId) {
      return;
    }

    const requestImageIds = requests.map(request => {
      return request.imageId;
    });

    const imageIds = getCenterSequentialFrames(requestImageIds);

    const reOrderedRequests = imageIds.map(({ imageId }) => {
      const request = requests.find(req => req.imageId === imageId);
      return request;
    });

    AllRequests.push(reOrderedRequests);
  });

  // flatten the AllRequests array, which will result in a list of all the
  // imageIds for all the volumes but zipped across volumes
  const interleavedRequests = compact(flatten(zip(...AllRequests)));

  // set the finalRequests to the imageLoadPoolManager
  const finalRequests = [];
  interleavedRequests.forEach(request => {
    const { imageId } = request;

    AllRequests.forEach(volumeRequests => {
      const volumeImageIdRequest = volumeRequests.find(req => req.imageId === imageId);
      if (volumeImageIdRequest) {
        finalRequests.push(volumeImageIdRequest);
      }
    });
  });

  const requestType = Enums.RequestType.Prefetch;
  const priority = 0;

  finalRequests.forEach(({ callLoadImage, additionalDetails, imageId, imageIdIndex, options }) => {
    const callLoadImageBound = callLoadImage.bind(null, imageId, imageIdIndex, options);

    imageLoadPoolManager.addRequest(callLoadImageBound, requestType, additionalDetails, priority);
  });

  // clear the volumeIdMapsToLoad
  volumeIdMapsToLoad.clear();

  // copy the viewportIdVolumeInputArrayMap
  const viewportIdVolumeInputArrayMapCopy = new Map(viewportIdVolumeInputArrayMap);

  // reset the viewportIdVolumeInputArrayMap
  viewportIdVolumeInputArrayMap.clear();

  return viewportIdVolumeInputArrayMapCopy;
}
