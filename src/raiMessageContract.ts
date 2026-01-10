export const RAI_MSG = {
  // Viewer controls (UI shell -> React viewer)
  WLWW_SET: "RAI:WLWW_SET",      // payload: { wc: number, ww: number }
  ZOOM_SET: "RAI:ZOOM_SET",      // payload: { zoom: number }
  PAN_SET:  "RAI:PAN_SET",       // payload: { dx: number, dy: number }
  CINE_SET: "RAI:CINE_SET",      // payload: { playing: boolean, fps?: number, dir?: 1 | -1 }

  // Study actions (UI shell -> React viewer)
  STUDY_LOAD: "RAI:STUDY_LOAD",  // payload: { files: Array<{ name: string }> }  (actual transport can vary)
  SLICE_SET:  "RAI:SLICE_SET",   // payload: { index: number }

  // Optional state sync (React viewer -> UI shell)
  STATE: "RAI:STATE"             // payload: { wc, ww, zoom, sliceIndex, sliceCount, playing, fps, dir }
} as const;

export type RaiMsgType = typeof RAI_MSG[keyof typeof RAI_MSG];

export type RaiEnvelope<T extends RaiMsgType = RaiMsgType, P = any> = {
  type: T;
  payload?: P;
};