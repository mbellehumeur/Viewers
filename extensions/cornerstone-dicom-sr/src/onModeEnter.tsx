import { SOPClassHandlerId, SOPClassHandlerId3D } from './id';

export default function onModeEnter({ servicesManager }) {
  const { displaySetService, hangingProtocolService, toolGroupService } = servicesManager.services;
  const displaySetCache = displaySetService.getDisplaySetCache();

  const srDisplaySets = [...displaySetCache.values()].filter(
    ds => ds.SOPClassHandlerId === SOPClassHandlerId || ds.SOPClassHandlerId === SOPClassHandlerId3D
  );

  srDisplaySets.forEach(ds => {
    // New mode route, allow SRs to be hydrated again
    ds.isHydrated = false;
  });

  // Ensure Arrow tool is available in all tool groups for SR hydration
  const toolGroupIds = toolGroupService.getToolGroupIds();
  toolGroupIds.forEach(toolGroupId => {
    // Specifically target MPR tool groups and any others that might need Arrow tool
    if (
      toolGroupId.includes('mpr') ||
      toolGroupId.includes('MPR') ||
      toolGroupId.includes('volume')
    ) {
      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (toolGroup) {
        try {
          if (!toolGroup.hasTool('ArrowAnnotate')) {
            toolGroup.addTool('ArrowAnnotate');
            console.log(`Added ArrowAnnotate tool to tool group: ${toolGroupId}`);
          }

          // Enable the tool for passive interaction (can see existing annotations)
          toolGroup.setToolEnabled('ArrowAnnotate');
          console.log(`Enabled ArrowAnnotate tool in tool group: ${toolGroupId}`);
        } catch (error) {
          console.warn(
            'Could not add/enable ArrowAnnotate tool to tool group:',
            toolGroupId,
            error
          );
        }
      }
    }
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
