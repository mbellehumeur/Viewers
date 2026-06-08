import { Types } from '@ohif/core';
import CastService from './services/CastService';

const commandsModule = ({
  servicesManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  const getCastService = () =>
    servicesManager.services.castService as InstanceType<typeof CastService>;

  const actions = {
    castPublishDicomSeries: async () => {
      return getCastService().publishDicomSendSeries();
    },
    castPublishDicomStudy: async () => {
      return getCastService().publishDicomSendStudy();
    },
  };

  const definitions = {
    castPublishDicomSeries: {
      commandFn: actions.castPublishDicomSeries,
      storeContexts: [],
      options: {},
    },
    castPublishDicomStudy: {
      commandFn: actions.castPublishDicomStudy,
      storeContexts: [],
      options: {},
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'CAST',
  };
};

export default commandsModule;
