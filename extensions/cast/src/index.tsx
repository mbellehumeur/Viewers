import { Types } from '@ohif/core';
import CastService from './services/CastService';

const extension: Types.Extensions.Extension = {
  id: '@ohif/extension-cast',

  async preRegistration({ servicesManager }) {
    servicesManager.registerService(CastService.REGISTRATION);
  },
};

export default extension;
