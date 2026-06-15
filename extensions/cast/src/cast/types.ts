import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';

export type { CastMessage };

export const ID_ACTOR_KEYWORD = 'ID';
export const WORKLIST_CLIENT_ACTOR_KEYWORD = 'WORKLIST_CLIENT';
export const DEFAULT_TARGET_ACTOR_KEYWORD = 'EC';

export type CastEvent = NonNullable<CastMessage['event']>;

export type GetRequestDataType =
  | 'PNGFULLSIZE'
  | 'JPGFULLSIZE'
  | 'PNGTHUMBNAIL'
  | 'JPGTHUMBNAIL';

export const SUPPORTED_GET_REQUEST_TYPES: GetRequestDataType[] = [
  'PNGFULLSIZE',
  'JPGFULLSIZE',
  'PNGTHUMBNAIL',
  'JPGTHUMBNAIL',
];

export type FilePayload =
  | { arrayBuffer: ArrayBuffer; fileName?: string; mimeType?: string }
  | { fileName: string; data: string; mimeType: string };

export type CastClientLike = {
  onMessage: (callback: (message: CastMessage) => void) => void;
  onConnectionStateChange: (
    callback: (state: string, detail?: unknown) => void
  ) => void;
  delete: () => void;
  getHubConfig: () => import('@kitware/vtk.js/Sources/IO/Core/CastClient').HubConfig;
  setTopic: (topic: string) => void;
  setToken?: (token: string) => void;
  setSubscriberName: (subscriberName: string) => void;
  setUserName?: (userName: string) => void;
  authenticate: () => Promise<{ user_name: string; code: string; expires_in?: number }>;
  getToken: (code: string) => Promise<boolean>;
  subscribe: () => Promise<number | string>;
  unsubscribe: () => Promise<void>;
  publish: (castMessage: Record<string, unknown>) => Promise<Response | null>;
  fetchPayload?: (message: CastMessage) => Promise<CastMessage>;
  fetchAllPayloads?: (message: CastMessage) => Promise<CastMessage>;
  hasPendingPayload?: (message: CastMessage) => boolean;
  getConnectionState: () => import('@kitware/vtk.js/Sources/IO/Core/CastClient').HubRuntimeState;
  getSessionConfig: () => import('@kitware/vtk.js/Sources/IO/Core/CastClient').SessionConfig;
  sendCastRequestResponse: (
    id: string,
    dataType: string,
    data: unknown,
    topic?: string
  ) => void;
  request: (args: CastMessage) => Promise<{ ok: boolean; status: number; data: unknown }>;
};

export type CommandsManagerLike = {
  runCommand: (commandName: string, commandOptions?: Record<string, unknown>) => void;
};

export type ServicesManagerLike = {
  services: {
    displaySetService: {
      getDisplaySetsForSeries: (seriesInstanceUID: string) => Array<{
        displaySetInstanceUID: string;
        SOPInstanceUID?: string;
        SeriesInstanceUID?: string;
        StudyInstanceUID?: string;
      }>;
      activeDisplaySets?: Array<{
        displaySetInstanceUID: string;
        SeriesInstanceUID?: string;
        StudyInstanceUID?: string;
      }>;
    };
    viewportGridService: {
      getActiveViewportId: () => string | undefined;
      getState: () => {
        viewports?: Map<
          string,
          { viewportId?: string; displaySetInstanceUIDs?: string[] }
        >;
      };
      getDisplaySetsUIDsForViewport: (viewportId: string) => string[];
    };
    cornerstoneViewportService?: {
      getViewportInfo: (viewportId: string) => unknown;
    };
    uiNotificationService?: {
      show: (options: {
        title: string;
        message: string | ((data?: unknown) => string);
        type?: 'success' | 'error' | 'info' | 'warning' | 'loading';
        duration?: number;
        promise?: Promise<unknown>;
        promiseMessages?: {
          loading?: string;
          success?: string | ((data: unknown) => string);
          error?: string | ((error: unknown) => string);
        };
        id?: string;
        allowDuplicates?: boolean;
      }) => string;
    };
  };
};
