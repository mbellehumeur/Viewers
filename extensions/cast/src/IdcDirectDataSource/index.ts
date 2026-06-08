import { createDicomLocalApi } from '@ohif/extension-default/src/DicomLocalDataSource/index';

type IdcDirectDataSourceConfig = {
  friendlyName?: string;
  name?: string;
};

/**
 * Memory-backed data source for IDC bucket direct download (Cast open-mode idc).
 * Instances are ingested into DicomMetadataStore before navigation; retrieval uses
 * blob URLs, not DICOMweb QIDO/WADO.
 */
export function createIdcDirectDownloadApi(config: IdcDirectDataSourceConfig = {}) {
  return createDicomLocalApi({
    name: config.name || 'idc',
    friendlyName: config.friendlyName || 'IDC direct download',
  });
}
