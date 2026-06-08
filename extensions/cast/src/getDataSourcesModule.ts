import { createIdcDirectDownloadApi } from './IdcDirectDataSource';

function getDataSourcesModule() {
  return [
    {
      name: 'idc-direct',
      type: 'localApi',
      createDataSource: createIdcDirectDownloadApi,
    },
  ];
}

export default getDataSourcesModule;
