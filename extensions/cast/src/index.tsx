import { Types } from '@ohif/core';
import CastService from './services/CastService';
import getCommandsModule from './commandsModule';
import getDataSourcesModule from './getDataSourcesModule';
import getCustomizationModule from './getCustomizationModule';

const extension: Types.Extensions.Extension = {
  id: '@ohif/extension-cast',

  async preRegistration({ servicesManager }) {
    servicesManager.registerService(CastService.REGISTRATION);
  },

  getCommandsModule,
  getDataSourcesModule,
  getCustomizationModule,
};

export default extension;
