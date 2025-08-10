import { SOPClassHandlerId, SOPClassHandlerId3D } from './id';

export default function onModeEnter({ servicesManager }) {
  const { displaySetService, hangingProtocolService } = servicesManager.services;
  const displaySetCache = displaySetService.getDisplaySetCache();

  const srDisplaySets = [...displaySetCache.values()].filter(
    ds => ds.SOPClassHandlerId === SOPClassHandlerId || ds.SOPClassHandlerId === SOPClassHandlerId3D
  );

  srDisplaySets.forEach(ds => {
    // New mode route, allow SRs to be hydrated again
    ds.isHydrated = false;
  });

  // If we have SR display sets, try to use a more appropriate protocol
  if (srDisplaySets.length > 0) {
    try {
      // Try to use a basic protocol that's more flexible with SR data
      const availableProtocols = hangingProtocolService.getProtocols();
      const flexibleProtocolIds = ['mpr', 'default', 'basic'];

      for (const protocolId of flexibleProtocolIds) {
        if (availableProtocols.find(p => p.id === protocolId)) {
          hangingProtocolService.setProtocol(protocolId);
          break;
        }
      }
    } catch (error) {
      console.warn('Could not set appropriate protocol for SR data:', error);
    }
  }
}
