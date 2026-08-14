/**
 * IDC SegRoulette collection ids (unique `col` values in segroulette.json).
 * Kept here (not imported from @ohif/extension-default) to avoid a circular
 * dependency: cornerstone customization → default → … → cornerstone.
 * Keep in sync with extensions/default/src/utils/segRoulette.ts.
 */
export const SEGROULETTE_COLLECTIONS = [
  'acrin_nsclc_fdg_pet',
  'adrenal_acc_ki67_seg',
  'anti_pd_1_lung',
  'c4kc_kits',
  'colorectal_liver_metastases',
  'cptac_ccrcc',
  'ct_lymph_nodes',
  'ct_phantom4radiomics',
  'duke_breast_cancer_mri',
  'eay131',
  'hcc_tace_seg',
  'lidc_idri',
  'lung_pet_ct_dx',
  'mediastinal_lymph_node_seg',
  'nlst',
  'nsclc_radiogenomics',
  'nsclc_radiomics',
  'nsclc_radiomics_interobserver1',
  'pancreas_ct',
  'prostate_mri_us_biopsy',
  'prostatex',
  'psma_pet_ct_lesions',
  'qin_breast',
  'qin_lung_ct',
  'qin_prostate_repeatability',
  'rider_lung_ct',
  'rider_lung_pet_ct',
  'spie_aapm_lung_ct_challenge',
  'spine_mets_ct_seg',
  'tcga_kich',
  'tcga_kirc',
  'tcga_kirp',
  'tcga_lihc',
  'tcga_luad',
  'tcga_lusc',
  'upenn_gbm',
] as const;

export function collectionButtonId(collection: string): string {
  return `SegRoulette__${collection}`;
}
