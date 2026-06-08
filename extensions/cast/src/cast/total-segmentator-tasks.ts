export type TotalSegmentatorQuality = 'normal' | 'fast' | 'faster';

export interface TotalSegmentatorTaskInfo {
  title: string;
  modalities?: ('CT' | 'MR')[];
  qualityModes?: TotalSegmentatorQuality[];
  description?: string;
  supportsMultiLabel?: boolean;
  requiresLicense?: boolean;
}

/** Task catalog ported from Slicer TotalSegmentatorLogic.tasks (insertion order). */
export const TOTAL_SEGMENTATOR_TASKS: Record<string, TotalSegmentatorTaskInfo> =
  {
    total: {
      title: 'total',
      modalities: ['CT'],
      qualityModes: ['normal', 'fast', 'faster'],
      supportsMultiLabel: true,
    },
    total_mr: {
      title: 'total (MR)',
      modalities: ['MR'],
      qualityModes: ['normal', 'fast', 'faster'],
      supportsMultiLabel: true,
    },
    vertebrae_mr: {
      title: 'vertebrae (MR)',
      modalities: ['MR'],
      description:
        'sacrum, vertebrae L1-5, vertebrae T1-12, vertebrae C1-7 (for CT this is part of the `total` task)',
      supportsMultiLabel: true,
    },
    lung_nodules: {
      title: 'lung: nodules',
      modalities: ['CT'],
      description:
        'lung, lung_nodules (provided by BLUEMIND AI) (trained on 1353 subjects, partly from LIDC-IDRI)',
      supportsMultiLabel: true,
    },
    lung_vessels: {
      title: 'lung: vessels and airways',
      modalities: ['CT'],
      description:
        'lung_airways, lung_airways_wall, lung_arteries, lung_veins',
      supportsMultiLabel: true,
    },
    kidney_cysts: {
      title: 'kidney: cysts',
      modalities: ['CT'],
      description:
        'kidney_cyst_left, kidney_cyst_right (strongly improved accuracy compared to kidney_cysts inside of `total` task)',
      supportsMultiLabel: true,
    },
    breasts: {
      title: 'breasts',
      modalities: ['CT'],
      supportsMultiLabel: true,
    },
    liver_segments: {
      title: 'liver: segments',
      modalities: ['CT'],
      description:
        'liver_segment_1, liver_segment_2, liver_segment_3, liver_segment_4, liver_segment_5, liver_segment_6, liver_segment_7, liver_segment_8 (Couinaud segments)',
      supportsMultiLabel: true,
    },
    liver_segments_mr: {
      title: 'liver: segments (MR)',
      modalities: ['MR'],
      description:
        'liver_segment_1, liver_segment_2, liver_segment_3, liver_segment_4, liver_segment_5, liver_segment_6, liver_segment_7, liver_segment_8 (for MR images) (Couinaud segments)',
      supportsMultiLabel: true,
    },
    liver_vessels: {
      title: 'liver: vessels',
      supportsMultiLabel: true,
    },
    liver_lesions: {
      title: 'liver: lesions',
      modalities: ['CT'],
      description: 'liver_lesions (trained on 842 subjects)',
      supportsMultiLabel: true,
    },
    liver_lesions_mr: {
      title: 'liver: lesions (MR)',
      modalities: ['MR'],
      description: 'liver_lesions for MR images (trained on 750 subjects)',
      supportsMultiLabel: true,
    },
    abdominal_muscles: {
      title: 'abdominal muscles',
      modalities: ['CT'],
      description:
        'pectoralis_major, rectus_abdominis, serratus_anterior, latissimus_dorsi, trapezius, external_oblique, internal_oblique, erector_spinae, transversospinalis, psoas_major, quadratus_lumborum (left/right)',
      supportsMultiLabel: true,
    },
    trunk_cavities: {
      title: 'trunk cavities',
      modalities: ['CT'],
      description:
        'abdominal_cavity, thoracic_cavity, pericardium, mediastinum',
      supportsMultiLabel: true,
    },
    body: {
      title: 'body',
      qualityModes: ['normal', 'fast'],
    },
    body_mr: {
      title: 'body (MR)',
      modalities: ['MR'],
      description: 'body_trunc, body_extremities (for MR images)',
      qualityModes: ['normal', 'fast'],
      supportsMultiLabel: true,
    },
    head_glands_cavities: {
      title: 'head: glands and cavities',
      supportsMultiLabel: true,
    },
    head_muscles: {
      title: 'head: muscles',
      supportsMultiLabel: true,
    },
    oculomotor_muscles: {
      title: 'head: oculomotor muscles',
      modalities: ['CT'],
      description:
        'skull, eyeball_right, lateral_rectus_muscle_right, superior_oblique_muscle_right, levator_palpebrae_superioris_right, superior_rectus_muscle_right, medial_rectus_muscle_left, inferior_oblique_muscle_right, inferior_rectus_muscle_right, optic_nerve_left, eyeball_left, lateral_rectus_muscle_left, superior_oblique_muscle_left, levator_palpebrae_superioris_left, superior_rectus_muscle_left, medial_rectus_muscle_right, inferior_oblique_muscle_left, inferior_rectus_muscle_left, optic_nerve_right',
      supportsMultiLabel: true,
    },
    craniofacial_structures: {
      title: 'head: craniofacial structures',
      modalities: ['CT'],
      description:
        'mandible, teeth_lower, skull, head, sinus_maxillary, sinus_frontal, teeth_upper',
      supportsMultiLabel: true,
    },
    teeth: {
      title: 'head: teeth',
      modalities: ['CT'],
      description:
        '77 classes: individual teeth (FDI numbering), jawbones, canals, sinuses, pulp chambers',
      supportsMultiLabel: true,
    },
    headneck_bones_vessels: {
      title: 'head and neck: bones and vessels',
      supportsMultiLabel: true,
    },
    headneck_muscles: {
      title: 'head and neck: muscles',
      supportsMultiLabel: true,
    },
    cerebral_bleed: {
      title: 'brain: cerebral bleed',
      supportsMultiLabel: true,
    },
    brain_aneurysm: {
      title: 'brain: aneurysm (TOF MRI)',
      modalities: ['MR'],
      description: 'brain_aneurysm (only works with TOF MRI images)',
      supportsMultiLabel: true,
    },
    hip_implant: {
      title: 'hip implant',
      supportsMultiLabel: true,
    },
    pleural_pericard_effusion: {
      title: 'heart: pleural and pericardial effusion',
      supportsMultiLabel: true,
    },
    coronary_arteries: {
      title: 'heart: coronary arteries',
      description: 'coronary_arteries (also works on non-contrast images)',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    vertebrae_body: {
      title: 'vertebrae body',
      requiresLicense: true,
    },
    appendicular_bones: {
      title: 'appendicular bones',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    appendicular_bones_mr: {
      title: 'appendicular bones (MR)',
      modalities: ['MR'],
      description:
        'patella, tibia, fibula, tarsal, metatarsal, phalanges_feet, ulna, radius (for MR images)',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    tissue_types: {
      title: 'tissue types',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    tissue_4_types: {
      title: 'tissue 4 types',
      description:
        'subcutaneous_fat, torso_fat, skeletal_muscle, intermuscular_fat (in contrast to `tissue_types` skeletal_muscle is split into two classes: muscle and fat)',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    tissue_types_mr: {
      title: 'tissue types (MR)',
      modalities: ['MR'],
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    heartchambers_highres: {
      title: 'heart: chambers highres',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    face: {
      title: 'face',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    face_mr: {
      title: 'face (MR)',
      modalities: ['MR'],
      description: 'face_region (for anonymization)',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    brain_structures: {
      title: 'brain: structures',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    thigh_shoulder_muscles: {
      title: 'thigh and shoulder: muscles',
      description:
        'quadriceps_femoris_left, quadriceps_femoris_right, thigh_medial_compartment_left, thigh_medial_compartment_right, thigh_posterior_compartment_left, thigh_posterior_compartment_right, sartorius_left, sartorius_right, deltoid, supraspinatus, infraspinatus, subscapularis, coracobrachial, trapezius, pectoralis_minor, serratus_anterior, teres_major, triceps_brachi',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
    thigh_shoulder_muscles_mr: {
      title: 'thigh and shoulder: muscles (MR)',
      description:
        'quadriceps_femoris_left, quadriceps_femoris_right, thigh_medial_compartment_left, thigh_medial_compartment_right, thigh_posterior_compartment_left, thigh_posterior_compartment_right, sartorius_left, sartorius_right, deltoid, supraspinatus, infraspinatus, subscapularis, coracobrachial, trapezius, pectoralis_minor, serratus_anterior, teres_major, triceps_brachi (for MR images)',
      supportsMultiLabel: true,
      requiresLicense: true,
    },
  };

const DEFAULT_QUALITY_MODES: TotalSegmentatorQuality[] = ['normal'];

export function getSupportedQualityModesForTask(
  taskId: string
): TotalSegmentatorQuality[] {
  const task = TOTAL_SEGMENTATOR_TASKS[taskId];
  if (task?.qualityModes) {
    return [...task.qualityModes];
  }
  return [...DEFAULT_QUALITY_MODES];
}

export interface TotalSegmentatorTaskSelectItem {
  value: string;
  title: string;
  description?: string;
}

export function taskSelectItems(): TotalSegmentatorTaskSelectItem[] {
  return Object.entries(TOTAL_SEGMENTATOR_TASKS).map(([value, info]) => {
    let title = info.title;
    if (info.requiresLicense) {
      title = `${title} [license required]`;
    }
    return {
      value,
      title,
      description: info.description,
    };
  });
}
