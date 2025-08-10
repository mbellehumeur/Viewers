import { utils, classes, DisplaySetService, Types as OhifTypes } from '@ohif/core';
import i18n from '@ohif/i18n';
import { Enums as CSExtensionEnums } from '@ohif/extension-cornerstone';
import { adaptersSR } from '@cornerstonejs/adapters';

import addSRAnnotation from './utils/addSRAnnotation';
import isRehydratable from './utils/isRehydratable';
import {
  SOPClassHandlerName,
  SOPClassHandlerId,
  SOPClassHandlerId3D,
  SOPClassHandlerName3D,
} from './id';
import { CodeNameCodeSequenceValues, CodingSchemeDesignators } from './enums';

const { sopClassDictionary } = utils;
const { CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION } = CSExtensionEnums;
const { MetadataProvider: metadataProvider } = classes;
const {
  TEXT_ANNOTATION_POSITION,
  COMMENT_CODE,
  CodeScheme: Cornerstone3DCodeScheme,
} = adaptersSR.Cornerstone3D;

type InstanceMetadata = OhifTypes.InstanceMetadata;

type SRDisplaySet = OhifTypes.DisplaySet & {
  isLoaded?: boolean;
  isImagingMeasurementReport?: boolean;
  referencedImages?: unknown[];
  measurements?: unknown[];
  instance: unknown;
  SOPClassUID: string;
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  load?: () => Promise<void>;
};

type ExtensionManagerLike = {
  getDataSources: (id?: string) => unknown[];
};

type DataSourceLike = {
  retrieve: {
    bulkDataURI: (opts: {
      BulkDataURI: string;
      StudyInstanceUID: string;
      SeriesInstanceUID: string;
      SOPInstanceUID: string;
    }) => Promise<unknown>;
  };
  getImageIdsForDisplaySet: (ds: unknown) => string[];
};

type Coord = {
  ValueType: string;
  GraphicType: string;
  GraphicData: number[];
  ReferencedSOPSequence?: {
    ReferencedSOPInstanceUID: string;
    ReferencedFrameNumber?: number;
  };
  ReferencedFrameOfReferenceSequence?: string;
};

// Helper: ConceptNameCodeSequence can be object or array; return the first item safely
function _firstConcept(item: unknown) {
  const seq = (item as { ConceptNameCodeSequence?: unknown })?.ConceptNameCodeSequence;
  return Array.isArray(seq) ? seq[0] : seq;
}

/**
 * TODO
 * - [ ] Add SR thumbnail
 * - [ ] Make viewport
 * - [ ] Get stacks from referenced displayInstanceUID and load into wrapped CornerStone viewport
 */

const sopClassUids = [
  sopClassDictionary.BasicTextSR,
  sopClassDictionary.EnhancedSR,
  sopClassDictionary.ComprehensiveSR,
];

const validateSameStudyUID = (uid: string, instances): void => {
  instances.forEach(it => {
    if (it.StudyInstanceUID !== uid) {
      console.warn('Not all instances have the same UID', uid, it);
      throw new Error(`Instances ${it.SOPInstanceUID} does not belong to ${uid}`);
    }
  });
};

/**
 * Adds instances to the DICOM SR series, rather than creating a new
 * series, so that as SR's are saved, they append to the series, and the
 * key image display set gets updated as well, containing just the new series.
 * @param instances is a list of instances from THIS series that are not
 *     in this DICOM SR Display Set already.
 */
function addInstances(instances: InstanceMetadata[], displaySetService: DisplaySetService) {
  this.instances.push(...instances);
  utils.sortStudyInstances(this.instances);
  // The last instance is the newest one, so is the one most interesting.
  // Eventually, the SR viewer should have the ability to choose which SR
  // gets loaded, and to navigate among them.
  this.instance = this.instances[this.instances.length - 1];
  this.isLoaded = false;
  return this;
}

/**
 * DICOM SR SOP Class Handler
 * For all referenced images in the TID 1500/300 sections, add an image to the
 * display.
 * @param instances is a set of instances all from the same series
 * @param servicesManager is the services that can be used for creating
 * @returns The list of display sets created for the given instances object
 */
function _getDisplaySetsFromSeries(
  instances,
  servicesManager: AppTypes.ServicesManager,
  extensionManager
) {
  // If the series has no instances, stop here
  if (!instances || !instances.length) {
    throw new Error('No instances were provided');
  }

  utils.sortStudyInstances(instances);
  // The last instance is the newest one, so is the one most interesting.
  // Eventually, the SR viewer should have the ability to choose which SR
  // gets loaded, and to navigate among them.
  const instance = instances[instances.length - 1];

  const {
    StudyInstanceUID,
    SeriesInstanceUID,
    SOPInstanceUID,
    SeriesDescription,
    SeriesNumber,
    SeriesDate,
    SeriesTime,
    ConceptNameCodeSequence,
    SOPClassUID,
  } = instance;
  validateSameStudyUID(instance.StudyInstanceUID, instances);

  const is3DSR = SOPClassUID === sopClassDictionary.Comprehensive3DSR;

  const isImagingMeasurementReport =
    ConceptNameCodeSequence?.CodeValue === CodeNameCodeSequenceValues.ImagingMeasurementReport;

  const displaySet = {
    Modality: 'SR',
    displaySetInstanceUID: utils.guid(),
    SeriesDescription,
    SeriesNumber,
    SeriesDate,
    SeriesTime,
    SOPInstanceUID,
    SeriesInstanceUID,
    StudyInstanceUID,
    SOPClassHandlerId: is3DSR ? SOPClassHandlerId3D : SOPClassHandlerId,
    SOPClassUID,
    instances,
    referencedImages: null,
    measurements: null,
    isDerivedDisplaySet: true,
    isLoaded: false,
    isImagingMeasurementReport,
    sopClassUids,
    instance,
    addInstances,
    label: SeriesDescription || `${i18n.t('Series')} ${SeriesNumber} - ${i18n.t('SR')}`,
  };

  (displaySet as unknown as SRDisplaySet).load = () =>
    _load(displaySet as unknown as SRDisplaySet, servicesManager, extensionManager);

  return [displaySet];
}

/**
 * Loads the display set with the given services and extension manager.
 * @param srDisplaySet - The display set to load.
 * @param servicesManager - The services manager containing displaySetService and measurementService.
 * @param extensionManager - The extension manager containing data sources.
 */
async function _load(
  srDisplaySet: SRDisplaySet,
  servicesManager: AppTypes.ServicesManager,
  extensionManager: AppTypes.ExtensionManager
) {
  const { displaySetService, measurementService } = servicesManager.services;
  const dataSources = (extensionManager as unknown as ExtensionManagerLike).getDataSources();
  const dataSource = dataSources[0] as DataSourceLike;
  const { ContentSequence } = srDisplaySet.instance;

  async function retrieveBulkData(obj, parentObj = null, key = null) {
    for (const prop in obj) {
      if (typeof obj[prop] === 'object' && obj[prop] !== null) {
        await retrieveBulkData(obj[prop], obj, prop);
      } else if (Array.isArray(obj[prop])) {
        await Promise.all(obj[prop].map(item => retrieveBulkData(item, obj, prop)));
      } else if (prop === 'BulkDataURI') {
        const value = await dataSource.retrieve.bulkDataURI({
          BulkDataURI: obj[prop],
          StudyInstanceUID: srDisplaySet.instance.StudyInstanceUID,
          SeriesInstanceUID: srDisplaySet.instance.SeriesInstanceUID,
          SOPInstanceUID: srDisplaySet.instance.SOPInstanceUID,
        });
        if (parentObj && key) {
          parentObj[key] = new Float32Array(value as ArrayBuffer);
        }
      }
    }
  }

  if (srDisplaySet.isLoaded !== true) {
    await retrieveBulkData(ContentSequence);
  }

  if (srDisplaySet.isImagingMeasurementReport) {
    srDisplaySet.referencedImages = _getReferencedImagesList(ContentSequence);
    srDisplaySet.measurements = _getMeasurements(ContentSequence);
  } else {
    srDisplaySet.referencedImages = [];
    srDisplaySet.measurements = [];
  }

  const mappings = measurementService.getSourceMappings(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );

  srDisplaySet.isHydrated = false;
  srDisplaySet.isRehydratable = isRehydratable(srDisplaySet, mappings);
  srDisplaySet.isLoaded = true;

  /** Check currently added displaySets and add measurements if the sources exist */
  displaySetService.activeDisplaySets.forEach(activeDisplaySet => {
    _checkIfCanAddMeasurementsToDisplaySet(
      srDisplaySet,
      activeDisplaySet,
      dataSource,
      servicesManager
    );
  });

  /** Subscribe to new displaySets as the source may come in after */
  displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_ADDED, data => {
    const { displaySetsAdded } = (data as { displaySetsAdded?: unknown[] }) || {};
    /**
     * If there are still some measurements that have not yet been loaded into cornerstone,
     * See if we can load them onto any of the new displaySets.
     */
    (displaySetsAdded || []).forEach(newDisplaySet => {
      _checkIfCanAddMeasurementsToDisplaySet(
        srDisplaySet,
        newDisplaySet,
        dataSource,
        servicesManager
      );
    });
  });
}

function _measurementBelongsToDisplaySet({ measurement, displaySet }) {
  return (
    measurement.coords[0].ReferencedFrameOfReferenceSequence === displaySet.FrameOfReferenceUID
  );
}

/**
 * Checks if measurements can be added to a display set.
 *
 * @param srDisplaySet - The source display set containing measurements.
 * @param newDisplaySet - The new display set to check if measurements can be added.
 * @param dataSource - The data source used to retrieve image IDs.
 * @param servicesManager - The services manager.
 */
function _checkIfCanAddMeasurementsToDisplaySet(
  srDisplaySet,
  newDisplaySet,
  dataSource,
  servicesManager: AppTypes.ServicesManager
) {
  const { customizationService } = servicesManager.services;

  const unloadedMeasurements = srDisplaySet.measurements.filter(
    measurement => measurement.loaded === false
  );

  if (!unloadedMeasurements.length || newDisplaySet.unsupported) {
    return;
  }

  // Create a Map to efficiently look up ImageIds by SOPInstanceUID and frame number
  const imageIdMap = new Map<string, string>();
  const imageIds = dataSource.getImageIdsForDisplaySet(newDisplaySet);

  for (const imageId of imageIds) {
    const { SOPInstanceUID, frameNumber } = metadataProvider.getUIDsFromImageID(imageId);
    const key = `${SOPInstanceUID}:${frameNumber || 1}`;
    imageIdMap.set(key, imageId);
  }

  if (!unloadedMeasurements?.length) {
    return;
  }

  const is3DSR = srDisplaySet.SOPClassUID === sopClassDictionary.Comprehensive3DSR;

  for (let j = unloadedMeasurements.length - 1; j >= 0; j--) {
    let measurement = unloadedMeasurements[j];
    const is3DMeasurement = measurement.coords?.[0]?.ValueType === 'SCOORD3D';

    const onBeforeSRAddMeasurement: unknown = customizationService.getCustomization(
      'onBeforeSRAddMeasurement'
    );

    if (typeof onBeforeSRAddMeasurement === 'function') {
      measurement = onBeforeSRAddMeasurement({
        measurement,
        StudyInstanceUID: srDisplaySet.StudyInstanceUID,
        SeriesInstanceUID: srDisplaySet.SeriesInstanceUID,
      });
    }

    // if it is 3d SR we can just add the SR annotation
    if (
      is3DSR &&
      is3DMeasurement &&
      _measurementBelongsToDisplaySet({ measurement, displaySet: newDisplaySet })
    ) {
      try {
        // For SCOORD3D POINT, only log the single point, not a slice of 6
        const isScoord3dPoint =
          measurement.coords?.[0]?.ValueType === 'SCOORD3D' &&
          measurement.coords?.[0]?.GraphicType === 'POINT';
        const points = isScoord3dPoint
          ? [measurement.coords?.[0]?.GraphicData]
          : measurement.coords?.[0]?.GraphicData?.slice?.(0, 6);
        console.debug('[SR] Will add 3D SR annotation to displaySet', {
          displaySetInstanceUID: newDisplaySet.displaySetInstanceUID,
          FrameOfReferenceUID: newDisplaySet.FrameOfReferenceUID,
          measurementFoR: measurement.coords?.[0]?.ReferencedFrameOfReferenceSequence,
          graphicType: measurement.coords?.[0]?.GraphicType,
          points,
        });
      } catch (_e) {
        /* ignore logging errors */
      }
      addSRAnnotation(measurement, null, null);
      measurement.loaded = true;
      measurement.displaySetInstanceUID = newDisplaySet.displaySetInstanceUID;
      unloadedMeasurements.splice(j, 1);
      continue;
    }

    const referencedSOPSequence = measurement.coords[0].ReferencedSOPSequence;
    if (!referencedSOPSequence) {
      continue;
    }

    const { ReferencedSOPInstanceUID } = referencedSOPSequence;
    const frame = referencedSOPSequence.ReferencedFrameNumber || 1;
    const key = `${ReferencedSOPInstanceUID}:${frame}`;
    const imageId = imageIdMap.get(key);

    if (
      imageId &&
      _measurementReferencesSOPInstanceUID(measurement, ReferencedSOPInstanceUID, frame)
    ) {
      try {
        console.debug('[SR] Will add 2D SR annotation to imageId', {
          displaySetInstanceUID: newDisplaySet.displaySetInstanceUID,
          imageId,
          frame,
          sopInstanceUID: ReferencedSOPInstanceUID,
          graphicType: measurement.coords?.[0]?.GraphicType,
          points: measurement.coords?.[0]?.GraphicData?.slice?.(0, 6),
        });
      } catch (_e) {
        /* ignore logging errors */
      }
      addSRAnnotation(measurement, imageId, frame);

      // Update measurement properties
      measurement.loaded = true;
      measurement.imageId = imageId;
      measurement.displaySetInstanceUID = newDisplaySet.displaySetInstanceUID;
      measurement.ReferencedSOPInstanceUID = ReferencedSOPInstanceUID;
      measurement.frameNumber = frame;

      unloadedMeasurements.splice(j, 1);
    }
  }
}

/**
 * Checks if a measurement references a specific SOP Instance UID.
 * @param measurement - The measurement object.
 * @param SOPInstanceUID - The SOP Instance UID to check against.
 * @param frameNumber - The frame number to check against (optional).
 * @returns True if the measurement references the specified SOP Instance UID, false otherwise.
 */
function _measurementReferencesSOPInstanceUID(measurement, SOPInstanceUID, frameNumber) {
  const { coords } = measurement;

  /**
   * NOTE: The ReferencedFrameNumber can be multiple values according to the DICOM
   * Standard. But for now, we will support only one ReferenceFrameNumber.
   */
  const ReferencedFrameNumber =
    (measurement.coords[0].ReferencedSOPSequence &&
      measurement.coords[0].ReferencedSOPSequence?.ReferencedFrameNumber) ||
    1;

  if (frameNumber && Number(frameNumber) !== Number(ReferencedFrameNumber)) {
    return false;
  }

  for (let j = 0; j < coords.length; j++) {
    const coord = coords[j];
    const { ReferencedSOPInstanceUID } = coord.ReferencedSOPSequence;
    if (ReferencedSOPInstanceUID === SOPInstanceUID) {
      return true;
    }
  }

  return false;
}

/**
 * Retrieves the SOP class handler module.
 *
 * @param {Object} options - The options for retrieving the SOP class handler module.
 * @param {Object} options.servicesManager - The services manager.
 * @param {Object} options.extensionManager - The extension manager.
 * @returns {Array} An array containing the SOP class handler module.
 */
function getSopClassHandlerModule(params: OhifTypes.Extensions.ExtensionParams) {
  const { servicesManager, extensionManager } = params;
  const getDisplaySetsFromSeries = instances => {
    return _getDisplaySetsFromSeries(instances, servicesManager, extensionManager);
  };
  return [
    {
      name: SOPClassHandlerName,
      sopClassUids,
      getDisplaySetsFromSeries,
    },
    {
      name: SOPClassHandlerName3D,
      sopClassUids: [sopClassDictionary.Comprehensive3DSR],
      getDisplaySetsFromSeries,
    },
  ];
}

/**
 * Retrieves the measurements from the ImagingMeasurementReportContentSequence.
 *
 * @param {Array} ImagingMeasurementReportContentSequence - The ImagingMeasurementReportContentSequence array.
 * @returns {Array} - The array of measurements.
 */
function _getMeasurements(ImagingMeasurementReportContentSequence) {
  const ImagingMeasurements = ImagingMeasurementReportContentSequence.find(
    item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.ImagingMeasurements
  );

  // Fallback: if no ImagingMeasurements container, try to build directly from top-level geometry
  if (!ImagingMeasurements) {
    const topLevel = _getSequenceAsArray(ImagingMeasurementReportContentSequence);
    const hasGeometry = topLevel.some(group => isScoordOr3d(group) && !isTextPosition(group));
    if (hasGeometry) {
      const m = _processTID1410Measurement(topLevel);
      try {
        console.debug('[SR] Parsed fallback top-level measurement', {
          graphicType: m?.coords?.[0]?.GraphicType,
          valueType: m?.coords?.[0]?.ValueType,
          points: m?.coords?.[0]?.GraphicData?.slice?.(0, 6),
        });
      } catch (_e) {
        /* ignore logging errors */
      }
      return m ? [m] : [];
    }
    return [];
  }

  const containerItems = _getSequenceAsArray(ImagingMeasurements.ContentSequence);
  const MeasurementGroups = containerItems.filter(
    item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.MeasurementGroup
  );

  // Fallback: no groups but geometry present inside container -> single measurement
  if (!MeasurementGroups.length) {
    const hasGeometry = containerItems.some(group => isScoordOr3d(group) && !isTextPosition(group));
    if (hasGeometry) {
      const m = _processTID1410Measurement(containerItems);
      try {
        console.debug('[SR] Parsed fallback container measurement', {
          graphicType: m?.coords?.[0]?.GraphicType,
          valueType: m?.coords?.[0]?.ValueType,
          points: m?.coords?.[0]?.GraphicData?.slice?.(0, 6),
        });
      } catch (_e) {
        /* ignore logging errors */
      }
      return m ? [m] : [];
    }
  }

  const mergedContentSequencesByTrackingUniqueIdentifiers =
    _getMergedContentSequencesByTrackingUniqueIdentifiers(MeasurementGroups);
  const measurements = [];

  Object.keys(mergedContentSequencesByTrackingUniqueIdentifiers).forEach(
    trackingUniqueIdentifier => {
      const mergedContentSequence =
        mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier];

      const measurement = _processMeasurement(mergedContentSequence);
      if (measurement) {
        measurements.push(measurement);
      }
    }
  );

  return measurements;
}

/**
 * Retrieves merged content sequences by tracking unique identifiers.
 *
 * @param {Array} MeasurementGroups - The measurement groups.
 * @returns {Object} - The merged content sequences by tracking unique identifiers.
 */
function _getMergedContentSequencesByTrackingUniqueIdentifiers(MeasurementGroups) {
  const mergedContentSequencesByTrackingUniqueIdentifiers = {};

  MeasurementGroups.forEach(MeasurementGroup => {
    const ContentSequence = _getSequenceAsArray(MeasurementGroup.ContentSequence);

    const TrackingUniqueIdentifierItem = ContentSequence.find(
      item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.TrackingUniqueIdentifier
    );
    if (!TrackingUniqueIdentifierItem?.UID) {
      console.warn('No Tracking Unique Identifier, skipping ambiguous measurement.');
      return;
    }

    const trackingUniqueIdentifier = TrackingUniqueIdentifierItem.UID;

    if (mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier] === undefined) {
      // Add the full ContentSequence
      mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier] = [
        ...ContentSequence,
      ];
    } else {
      // Add the ContentSequence minus the tracking identifier, as we have this
      // Information in the merged ContentSequence anyway.
      ContentSequence.forEach(item => {
        if (
          _firstConcept(item)?.CodeValue !== CodeNameCodeSequenceValues.TrackingUniqueIdentifier
        ) {
          mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier].push(item);
        }
      });
    }
  });

  return mergedContentSequencesByTrackingUniqueIdentifiers;
}

/**
 * Processes the measurement based on the merged content sequence.
 * If the merged content sequence contains SCOORD or SCOORD3D value types,
 * it calls the _processTID1410Measurement function.
 * Otherwise, it calls the _processNonGeometricallyDefinedMeasurement function.
 *
 * @param {Array<Object>} mergedContentSequence - The merged content sequence to process.
 * @returns {any} - The processed measurement result.
 */
function _processMeasurement(mergedContentSequence) {
  if (mergedContentSequence.some(group => isScoordOr3d(group) && !isTextPosition(group))) {
    return _processTID1410Measurement(mergedContentSequence);
  }

  return _processNonGeometricallyDefinedMeasurement(mergedContentSequence);
}

/**
 * Processes TID 1410 style measurements from the mergedContentSequence.
 * TID 1410 style measurements have a SCOORD or SCOORD3D at the top level,
 * and non-geometric representations where each NUM has "INFERRED FROM" SCOORD/SCOORD3D.
 *
 * Special customization: SCOORD3D with GraphicType "POINT" is treated as a single point
 * measurement regardless of coordinate count, and is assigned measurementType "point".
 *
 * @param mergedContentSequence - The merged content sequence containing the measurements.
 * @returns The measurement object containing the loaded status, labels, coordinates, tracking unique identifier, and tracking identifier.
 */
function _processTID1410Measurement(mergedContentSequence) {
  // Need to deal with TID 1410 style measurements, which will have a SCOORD or SCOORD3D at the top level,
  // And non-geometric representations where each NUM has "INFERRED FROM" SCOORD/SCOORD3D

  const graphicItem = mergedContentSequence.find(
    group => group.ValueType === 'SCOORD' || group.ValueType === 'SCOORD3D'
  );

  const UIDREFContentItem = mergedContentSequence.find(group => group.ValueType === 'UIDREF');

  const TrackingIdentifierContentItem = mergedContentSequence.find(
    item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.TrackingIdentifier
  );

  if (!graphicItem) {
    console.warn('No SCOORD/SCOORD3D found, skipping annotation.');
    return;
  }

  const NUMContentItems = mergedContentSequence.filter(group => group.ValueType === 'NUM');

  const conceptNameItem = _firstConcept(graphicItem);
  const graphicValue = conceptNameItem?.CodeValue;
  const graphicDesignator = conceptNameItem?.CodingSchemeDesignator;
  const graphicCode =
    graphicDesignator && graphicValue ? `${graphicDesignator}:${graphicValue}` : undefined;

  const pointDataItem = _getCoordsFromSCOORDOrSCOORD3D(graphicItem);
  const is3DMeasurement = pointDataItem.ValueType === 'SCOORD3D';
  const pointLength = is3DMeasurement ? 3 : 2;

  // Special handling for SCOORD3D POINT measurements - should always be 1 point regardless of coordinate count
  let pointsLength;
  if (requiresSpecialScoord3dPointHandling(pointDataItem)) {
    pointsLength = 1;
    console.debug('[SR] Special SCOORD3D POINT handling applied', {
      conceptName: conceptNameItem?.CodeMeaning,
      graphicType: pointDataItem.GraphicType,
      valueType: pointDataItem.ValueType,
      coordinateCount: pointDataItem.GraphicData?.length,
      pointsLength,
    });
  } else {
    pointsLength = (pointDataItem.GraphicData?.length || 0) / pointLength;
  }

  const measurement = {
    loaded: false,
    labels: [],
    coords: [pointDataItem],
    TrackingUniqueIdentifier: UIDREFContentItem?.UID ?? utils.guid(),
    TrackingIdentifier:
      TrackingIdentifierContentItem?.TextValue ?? conceptNameItem?.CodeMeaning ?? 'SR Measurement',
    graphicCode,
    is3DMeasurement,
    pointsLength,
    graphicType: pointDataItem.GraphicType,
    // Special handling for SCOORD3D POINT measurements - ensure they are treated as point type
    measurementType: requiresSpecialScoord3dPointHandling(pointDataItem) ? 'point' : undefined,
  };

  NUMContentItems.forEach(item => {
    const { ConceptNameCodeSequence, MeasuredValueSequence } = item;
    if (MeasuredValueSequence) {
      measurement.labels.push(
        _getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence)
      );
    }
  });

  const findingSites = mergedContentSequence.filter(item => {
    const c = _firstConcept(item);
    return (
      c?.CodingSchemeDesignator === CodingSchemeDesignators.SCT &&
      c?.CodeValue === CodeNameCodeSequenceValues.FindingSiteSCT
    );
  });
  if (findingSites.length) {
    measurement.labels.push({
      label: CodeNameCodeSequenceValues.FindingSiteSCT,
      value: (Array.isArray(findingSites[0]?.ConceptCodeSequence)
        ? findingSites[0]?.ConceptCodeSequence?.[0]
        : findingSites[0]?.ConceptCodeSequence
      )?.CodeMeaning,
    });
  }

  return measurement;
}

/**
 * Processes the non-geometrically defined measurement from the merged content sequence.
 *
 * @param mergedContentSequence The merged content sequence containing the measurement data.
 * @returns The processed measurement object.
 */
function _processNonGeometricallyDefinedMeasurement(mergedContentSequence) {
  const NUMContentItems = mergedContentSequence.filter(group => group.ValueType === 'NUM');
  const UIDREFContentItem = mergedContentSequence.find(group => group.ValueType === 'UIDREF');

  const TrackingIdentifierContentItem = mergedContentSequence.find(
    item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.TrackingIdentifier
  );

  const finding = mergedContentSequence.find(
    item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.Finding
  );

  const findingSites = mergedContentSequence.filter(item => {
    const c = _firstConcept(item);
    return (
      c?.CodingSchemeDesignator === CodingSchemeDesignators.SRT &&
      c?.CodeValue === CodeNameCodeSequenceValues.FindingSite
    );
  });

  const commentSites = mergedContentSequence.filter(item => {
    const c = _firstConcept(item);
    return (
      c?.CodingSchemeDesignator === COMMENT_CODE.schemeDesignator &&
      c?.CodeValue === COMMENT_CODE.value
    );
  });

  const measurement = {
    loaded: false,
    labels: [],
    coords: [],
    TrackingUniqueIdentifier: UIDREFContentItem?.UID ?? utils.guid(),
    TrackingIdentifier: TrackingIdentifierContentItem?.TextValue ?? 'SR Measurement',
  };

  if (commentSites) {
    for (const group of commentSites) {
      if (group.TextValue) {
        measurement.labels.push({ label: group.TextValue, value: '' });
      }
    }
  }

  if (finding) {
    const cc = Array.isArray(finding.ConceptCodeSequence)
      ? finding.ConceptCodeSequence[0]
      : finding.ConceptCodeSequence;
    if (
      CodingSchemeDesignators.CornerstoneCodeSchemes.includes(cc?.CodingSchemeDesignator) &&
      cc?.CodeValue === Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT
    ) {
      measurement.labels.push({
        label: Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT,
        value: cc?.CodeMeaning,
      });
    }
  }

  // TODO -> Eventually hopefully support SNOMED or some proper code library, just free text for now.
  if (findingSites.length) {
    const cornerstoneFreeTextFindingSite = findingSites.find(FindingSite => {
      const cc = Array.isArray(FindingSite.ConceptCodeSequence)
        ? FindingSite.ConceptCodeSequence[0]
        : FindingSite.ConceptCodeSequence;
      return (
        CodingSchemeDesignators.CornerstoneCodeSchemes.includes(cc?.CodingSchemeDesignator) &&
        cc?.CodeValue === Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT
      );
    });

    if (cornerstoneFreeTextFindingSite) {
      const cc = Array.isArray(cornerstoneFreeTextFindingSite.ConceptCodeSequence)
        ? cornerstoneFreeTextFindingSite.ConceptCodeSequence[0]
        : cornerstoneFreeTextFindingSite.ConceptCodeSequence;
      measurement.labels.push({
        label: Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT,
        value: cc?.CodeMeaning,
      });
    }
  }

  NUMContentItems.forEach(item => {
    const { ConceptNameCodeSequence, ContentSequence, MeasuredValueSequence } = item;

    const ValueType = ContentSequence?.ValueType;
    if (ValueType && ValueType !== 'SCOORD' && ValueType !== 'SCOORD3D') {
      console.warn(`Graphic ${ValueType} not currently supported, skipping annotation.`);
      return;
    }

    const coords = _getCoordsFromSCOORDOrSCOORD3D(ContentSequence || {});
    if (coords?.GraphicData?.length) {
      measurement.coords.push(coords);
    }

    if (MeasuredValueSequence) {
      measurement.labels.push(
        _getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence)
      );
    }
  });

  return measurement;
}

/**
 * Extracts coordinates from a graphic item of type SCOORD or SCOORD3D.
 * @param {object} graphicItem - The graphic item containing the coordinates.
 * @returns {object} - The extracted coordinates.
 */
type GraphicItem = {
  ValueType: string;
  GraphicType: string;
  GraphicData: number[];
  ContentSequence?: {
    ReferencedSOPSequence?: { ReferencedSOPInstanceUID: string; ReferencedFrameNumber?: number };
    ReferencedFrameOfReferenceSequence?: string;
  };
  ReferencedFrameOfReferenceUID?: string;
};

const _getCoordsFromSCOORDOrSCOORD3D = (graphicItem: GraphicItem) => {
  const { ValueType, GraphicType, GraphicData } = graphicItem;
  const coords: Coord = { ValueType, GraphicType, GraphicData };
  coords.ReferencedSOPSequence = graphicItem.ContentSequence?.ReferencedSOPSequence;
  coords.ReferencedFrameOfReferenceSequence =
    graphicItem.ReferencedFrameOfReferenceUID ||
    graphicItem.ContentSequence?.ReferencedFrameOfReferenceSequence;
  return coords;
};

/**
 * Retrieves the label and value from the provided ConceptNameCodeSequence and MeasuredValueSequence.
 * @param {Object} ConceptNameCodeSequence - The ConceptNameCodeSequence object.
 * @param {Object} MeasuredValueSequence - The MeasuredValueSequence object.
 * @returns {Object} - An object containing the label and value.
 *                    The label represents the CodeMeaning from the ConceptNameCodeSequence.
 *                    The value represents the formatted NumericValue and CodeValue from the MeasuredValueSequence.
 *                    Example: { label: 'Long Axis', value: '31.00 mm' }
 */
function _getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence) {
  const cnc = Array.isArray(ConceptNameCodeSequence)
    ? ConceptNameCodeSequence[0]
    : ConceptNameCodeSequence;
  const mvs = Array.isArray(MeasuredValueSequence)
    ? MeasuredValueSequence[0]
    : MeasuredValueSequence;

  const { CodeMeaning } = cnc || {};
  const { NumericValue, MeasurementUnitsCodeSequence } = mvs || {};
  const mucs = Array.isArray(MeasurementUnitsCodeSequence)
    ? MeasurementUnitsCodeSequence[0]
    : MeasurementUnitsCodeSequence;
  const { CodeValue } = mucs || {};
  const formatedNumericValue = NumericValue !== undefined ? Number(NumericValue).toFixed(2) : '';
  return {
    label: CodeMeaning || '',
    value: CodeValue ? `${formatedNumericValue} ${CodeValue}` : formatedNumericValue,
  }; // E.g. Long Axis: 31.0 mm
}

/**
 * Retrieves a list of referenced images from the Imaging Measurement Report Content Sequence.
 *
 * @param {Array} ImagingMeasurementReportContentSequence - The Imaging Measurement Report Content Sequence.
 * @returns {Array} - The list of referenced images.
 */
function _getReferencedImagesList(ImagingMeasurementReportContentSequence) {
  const ImageLibrary = ImagingMeasurementReportContentSequence.find(
    item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.ImageLibrary
  );

  if (!ImageLibrary) {
    return [];
  }

  const ImageLibraryGroup = _getSequenceAsArray(ImageLibrary.ContentSequence).find(
    item => _firstConcept(item)?.CodeValue === CodeNameCodeSequenceValues.ImageLibraryGroup
  );
  if (!ImageLibraryGroup) {
    return [];
  }

  const referencedImages = [];

  _getSequenceAsArray(ImageLibraryGroup.ContentSequence).forEach(item => {
    const { ReferencedSOPSequence } = item;
    if (!ReferencedSOPSequence) {
      return;
    }
    for (const ref of _getSequenceAsArray(ReferencedSOPSequence)) {
      if (ref.ReferencedSOPClassUID) {
        const { ReferencedSOPClassUID, ReferencedSOPInstanceUID } = ref;

        referencedImages.push({
          ReferencedSOPClassUID,
          ReferencedSOPInstanceUID,
        });
      }
    }
  });

  return referencedImages;
}

/**
 * Converts a DICOM sequence to an array.
 * If the sequence is null or undefined, an empty array is returned.
 * If the sequence is already an array, it is returned as is.
 * Otherwise, the sequence is wrapped in an array and returned.
 *
 * @param {any} sequence - The DICOM sequence to convert.
 * @returns {any[]} - The converted array.
 */
function _getSequenceAsArray(sequence) {
  if (!sequence) {
    return [];
  }
  return Array.isArray(sequence) ? sequence : [sequence];
}

function isScoordOr3d(group) {
  return group.ValueType === 'SCOORD' || group.ValueType === 'SCOORD3D';
}

function isTextPosition(group) {
  const concept = group.ConceptNameCodeSequence[0];
  return (
    concept &&
    concept.CodeValue === TEXT_ANNOTATION_POSITION.value &&
    concept.CodingSchemeDesignator === TEXT_ANNOTATION_POSITION.schemeDesignator
  );
}

/**
 * Checks if the SR measurement requires special handling for SCOORD3D POINT format.
 * This handles cases where SCOORD3D with GraphicType "POINT" should be treated as
 * a single point measurement regardless of coordinate count.
 *
 * @param graphicItem - The graphic item containing ValueType and GraphicType
 * @returns True if this is a SCOORD3D POINT that needs special handling
 */
function requiresSpecialScoord3dPointHandling(graphicItem) {
  return graphicItem.ValueType === 'SCOORD3D' && graphicItem.GraphicType === 'POINT';
}

export default getSopClassHandlerModule;
